import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Inject } from '@nestjs/common';
import {
  PublicUser,
  toPublicUser,
  USER_STORE,
  UserStore,
} from '../storage/stores';
import { ssoConfig } from './sso.config';

/** 进行中的授权会话（state → 一次性 PKCE/nonce 上下文），TTL 10 分钟。 */
interface PendingAuth {
  nonce: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 首次登录头像：hash(ssoSub) % 6 + 1。 */
export function avatarIdFor(ssoSub: string): number {
  const h = createHash('sha256').update(ssoSub).digest();
  return (h.readUInt32BE(0) % 6) + 1;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private pending = new Map<string, PendingAuth>();

  constructor(
    @Inject(USER_STORE) private readonly users: UserStore,
    private readonly jwt: JwtService,
  ) {}

  // ---------- SSO 授权码流程 ----------

  /** GET /auth/sso/start：生成 state/nonce/PKCE → 返回 302 目标 URL。 */
  buildAuthorizeUrl(): string {
    const cfg = ssoConfig();
    this.sweepExpired();
    const state = b64url(randomBytes(16));
    const nonce = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(
      createHash('sha256').update(verifier).digest(),
    );
    this.pending.set(state, {
      nonce,
      verifier,
      redirectUri: cfg.redirectUri,
      createdAt: Date.now(),
    });
    const url = new URL(`${cfg.issuer}/oauth2/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: 'openid profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /**
   * GET /auth/sso/callback：校验 state → 换 token → jose 校验 id_token
   * → 取 profile → 按 ssoSub upsert → 签发我方 JWT → 返回前端回跳 URL。
   * 任何失败一律抛出 400（不泄露内部细节）。
   */
  async handleCallback(params: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    try {
      if (params.error || !params.code || !params.state) {
        throw new Error('missing code/state');
      }
      const cfg = ssoConfig();
      const pending = this.pending.get(params.state);
      if (!pending) {
        throw new Error('state mismatch');
      }
      this.pending.delete(params.state); // 一次性消费
      if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
        throw new Error('state expired');
      }

      // ① 授权码 → 令牌（Basic client_id:secret + code_verifier）
      const basic = Buffer.from(
        `${cfg.clientId}:${cfg.clientSecret}`,
      ).toString('base64');
      const tokenResp = await fetch(`${cfg.issuer}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: pending.redirectUri,
          code_verifier: pending.verifier,
        }),
      });
      if (!tokenResp.ok) {
        throw new Error(`token endpoint ${tokenResp.status}`);
      }
      const tokens = (await tokenResp.json()) as {
        access_token?: string;
        id_token?: string;
      };
      if (!tokens.access_token || !tokens.id_token) {
        throw new Error('missing tokens');
      }

      // ② 用 JWKS 校验 id_token（iss/aud/RS256/exp + nonce）
      const jwks = createRemoteJWKSet(
        new URL(`${cfg.issuer}/oauth2/jwks.json`),
      );
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: cfg.issuer,
        audience: cfg.clientId,
        algorithms: ['RS256'],
        clockTolerance: 60,
      });
      if (!payload.sub || payload.nonce !== pending.nonce) {
        throw new Error('nonce mismatch');
      }

      // ③ profile：data.user_id / public_id / display_name
      const profileResp = await fetch(`${cfg.issuer}/oauth2/profile`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileResp.ok) {
        throw new Error(`profile endpoint ${profileResp.status}`);
      }
      const profile = (await profileResp.json()) as {
        data?: {
          user_id?: string;
          public_id?: number | null;
          display_name?: string;
        };
      };
      const ssoSub = profile.data?.user_id ?? payload.sub;
      const displayName =
        profile.data?.display_name?.trim() ||
        (payload.name as string | undefined)?.trim() ||
        ssoSub;
      const publicId =
        typeof profile.data?.public_id === 'number'
          ? profile.data.public_id
          : null;

      // ④ 按 ssoSub upsert（首次分配 avatarId）
      const { user } = await this.users.upsertBySso({
        ssoSub,
        username: displayName,
        publicId,
        avatarId: avatarIdFor(ssoSub),
      });

      // ⑤ 签发我方 JWT（7 天，载荷兼容现有守卫）
      const token = await this.jwt.signAsync({
        sub: user.id,
        username: user.username,
        avatarId: user.avatarId,
        publicId: user.publicId,
      });
      return `${cfg.frontendOrigin}/login#token=${encodeURIComponent(token)}`;
    } catch (e) {
      this.logger.warn(`SSO 回调失败：${(e as Error).message}`);
      throw new BadRequestException('登录失败');
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [state, p] of this.pending) {
      if (now - p.createdAt > PENDING_AUTH_TTL_MS) {
        this.pending.delete(state);
      }
    }
  }

  // ---------- 本地用户 ----------

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    return toPublicUser(user);
  }
}
