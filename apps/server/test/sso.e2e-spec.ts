/**
 * SSO 登录全链路 e2e：进程内伪造 IdP（discovery/JWKS RS256/token/profile）
 * 驱动 start → authorize → callback → 我方 JWT → /users/me。
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { USER_STORE, UserStore } from '../src/storage/stores';
import { startFakeIdP, type FakeIdP } from './fake-idp';

const ENV_KEYS = [
  'SSO_ISSUER',
  'SSO_CLIENT_ID',
  'SSO_CLIENT_SECRET',
  'SERVER_PUBLIC_URL',
  'FRONTEND_ORIGIN',
] as const;

describe('SSO 登录（e2e，伪造 IdP）', () => {
  let app: INestApplication;
  let http: any;
  let idp: FakeIdP;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    idp = await startFakeIdP();
    process.env.SSO_ISSUER = idp.issuer;
    process.env.SSO_CLIENT_ID = 'guess-draw-anime';
    process.env.SSO_CLIENT_SECRET = 'testsecret';
    process.env.SERVER_PUBLIC_URL = 'http://server.test';
    process.env.FRONTEND_ORIGIN = 'http://127.0.0.1:5175';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  /** 走一遍 start → IdP authorize → callback，返回 302 响应。 */
  async function driveLogin() {
    const start = await request(http)
      .get('/auth/sso/start')
      .redirects(0)
      .expect(302);
    const authz = new URL(start.headers.location);
    expect(authz.origin + authz.pathname).toBe(`${idp.issuer}/oauth2/authorize`);
    expect(authz.searchParams.get('client_id')).toBe('guess-draw-anime');
    expect(authz.searchParams.get('scope')).toBe('openid profile');
    expect(authz.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authz.searchParams.get('redirect_uri')).toBe(
      'http://server.test/auth/sso/callback',
    );
    const state = authz.searchParams.get('state')!;
    const nonce = authz.searchParams.get('nonce')!;
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();

    const authorize = await fetch(authz.toString(), { redirect: 'manual' });
    expect(authorize.status).toBe(302);
    const back = new URL(authorize.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(
      'http://server.test/auth/sso/callback',
    );
    const code = back.searchParams.get('code')!;
    expect(back.searchParams.get('state')).toBe(state);
    expect(back.searchParams.get('iss')).toBe(idp.issuer);
    expect(code).toBeTruthy();

    const cb = await request(http)
      .get('/auth/sso/callback')
      .query({ code, state })
      .redirects(0)
      .expect(302);
    return cb as request.Response;
  }

  function tokenFrom(cb: request.Response): string {
    const location = cb.headers.location as string;
    expect(location.startsWith('http://127.0.0.1:5175/login#token=')).toBe(true);
    const token = location.slice(location.indexOf('#token=') + 7);
    expect(token.split('.')).toHaveLength(3);
    return token;
  }

  it('GET /auth/sso/start 公开且 302 到 IdP authorize（见 driveLogin 断言）', async () => {
    await driveLogin();
  });

  it('完整登录：302 到前端 #token=，JWT 可访问 /users/me（avatarId=hash%6+1）', async () => {
    const cb = await driveLogin();
    const token = tokenFrom(cb);
    const me = await request(http)
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const expectedAvatar =
      (createHash('sha256').update(idp.sub).digest().readUInt32BE(0) % 6) + 1;
    expect(me.body).toMatchObject({
      username: idp.display_name,
      publicId: idp.public_id,
      avatarId: expectedAvatar,
    });
    expect(typeof me.body.id).toBe('string');
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('state 篡改 / 缺失返回 400（不泄露细节）', async () => {
    const res = await request(http)
      .get('/auth/sso/callback')
      .query({ code: 'whatever', state: 'tampered-state' })
      .redirects(0)
      .expect(400);
    expect(String(res.text)).not.toMatch(/jose|jwks|token endpoint|nonce/i);
    await request(http)
      .get('/auth/sso/callback')
      .query({ code: 'only-code' })
      .redirects(0)
      .expect(400);
  });

  it('相同 ssoSub 二次登录 upsert 不重复建号', async () => {
    const users: UserStore = app.get(USER_STORE);
    const before = await users.count();
    expect(before).toBeGreaterThanOrEqual(1);

    const first = tokenFrom(await driveLogin());
    const firstMe = await request(http)
      .get('/users/me')
      .set('Authorization', `Bearer ${first}`)
      .expect(200);

    const second = tokenFrom(await driveLogin());
    const secondMe = await request(http)
      .get('/users/me')
      .set('Authorization', `Bearer ${second}`)
      .expect(200);

    expect(secondMe.body.id).toBe(firstMe.body.id);
    expect(await users.count()).toBe(before);
    const record = await users.findBySsoSub(idp.sub);
    expect(record?.id).toBe(firstMe.body.id);
    expect(record?.username).toBe(idp.display_name);
    expect(record?.publicId).toBe(idp.public_id);
  });

  it('POST /auth/register 与 POST /auth/login 已移除（404）', async () => {
    await request(http)
      .post('/auth/register')
      .send({ username: 'alice', password: 'secret1' })
      .expect(404);
    await request(http)
      .post('/auth/login')
      .send({ username: 'alice', password: 'secret1' })
      .expect(404);
  });
});
