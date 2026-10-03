/**
 * 进程内伪造 OIDC IdP（e2e 专用）：
 * discovery 文档 / RS256 JWKS / oauth2/authorize（302 回跳带 code）/
 * oauth2/token（Basic + PKCE S256 校验，签发 id_token）/ oauth2/profile。
 */
import { createHash, generateKeyPairSync } from 'node:crypto';
import * as http from 'node:http';
import { importJWK, SignJWT, type JWK } from 'jose';

export interface FakeIdP {
  issuer: string;
  sub: string;
  display_name: string;
  public_id: number;
  close(): Promise<void>;
}

interface StoredCode {
  nonce: string;
  challenge: string;
  redirectUri: string;
  clientId: string;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function startFakeIdP(options?: {
  sub?: string;
  display_name?: string;
  public_id?: number;
}): Promise<FakeIdP> {
  const sub = options?.sub ?? 'sso-user-1';
  const displayName = options?.display_name ?? '测试用户';
  const publicId = options?.public_id ?? 101;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const pubJwk = publicKey.export({ format: 'jwk' }) as JWK;
  const privJwk = privateKey.export({ format: 'jwk' }) as JWK;
  const signingKey = await importJWK(
    { ...privJwk, alg: 'RS256' },
    'RS256',
  );
  const jwks = {
    keys: [{ ...pubJwk, kid: 'fake-key-1', alg: 'RS256', use: 'sig' }],
  };

  const codes = new Map<string, StoredCode>();
  let issuer = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer || 'http://127.0.0.1');
    void handle(req, res, url).catch((e) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    });
  });

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          jwks_uri: `${issuer}/oauth2/jwks.json`,
          userinfo_endpoint: `${issuer}/oauth2/userinfo`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          scopes_supported: ['openid', 'profile'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        }),
      );
      return;
    }
    if (url.pathname === '/oauth2/jwks.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks));
      return;
    }
    if (url.pathname === '/oauth2/authorize' && req.method === 'GET') {
      const clientId = url.searchParams.get('client_id') ?? '';
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';
      const challenge = url.searchParams.get('code_challenge') ?? '';
      const method = url.searchParams.get('code_challenge_method') ?? '';
      if (
        clientId !== 'guess-draw-anime' ||
        !redirectUri ||
        !challenge ||
        method !== 'S256'
      ) {
        res.statusCode = 400;
        res.end('bad authorize request');
        return;
      }
      const code = b64url(`${Date.now()}-${Math.random()}`);
      codes.set(code, { nonce, challenge, redirectUri, clientId });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', state);
      back.searchParams.set('iss', issuer);
      res.statusCode = 302;
      res.setHeader('location', back.toString());
      res.end();
      return;
    }
    if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const auth = req.headers.authorization ?? '';
      const expected = `Basic ${Buffer.from('guess-draw-anime:testsecret').toString('base64')}`;
      const stored = codes.get(body.get('code') ?? '');
      const verifier = body.get('code_verifier') ?? '';
      const challengeOk =
        !!stored &&
        b64url(createHash('sha256').update(verifier).digest()) ===
          stored.challenge;
      if (
        auth !== expected ||
        !stored ||
        body.get('grant_type') !== 'authorization_code' ||
        body.get('redirect_uri') !== stored.redirectUri ||
        !challengeOk
      ) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      codes.delete(body.get('code')!);
      const idToken = await new SignJWT({ nonce: stored.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'fake-key-1' })
        .setIssuer(issuer)
        .setAudience(stored.clientId)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(signingKey);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          access_token: `at-${sub}`,
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 900,
          scope: 'openid profile',
        }),
      );
      return;
    }
    if (url.pathname === '/oauth2/profile' && req.method === 'GET') {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer at-${sub}`) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          version: 1,
          iss: issuer,
          sub,
          data: {
            user_id: sub,
            public_id: publicId,
            display_name: displayName,
            username: 'tester',
            email: 'tester@localhost',
            email_verified: true,
            coins: 0,
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('fake idp: no port');
  }
  issuer = `http://127.0.0.1:${addr.port}`;

  return {
    issuer,
    sub,
    display_name: displayName,
    public_id: publicId,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
