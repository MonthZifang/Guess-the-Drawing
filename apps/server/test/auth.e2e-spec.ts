/**
 * Auth 基础（e2e）：密码注册/登录已移除；/users/me 守卫与健康检查。
 * SSO 全链路见 sso.e2e-spec.ts。
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let http: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register 返回 404（密码注册已移除）', async () => {
    await request(http)
      .post('/auth/register')
      .send({ username: 'alice', password: 'secret1' })
      .expect(404);
  });

  it('POST /auth/login 返回 404（密码登录已移除）', async () => {
    await request(http)
      .post('/auth/login')
      .send({ username: 'alice', password: 'secret1' })
      .expect(404);
  });

  it('GET /auth/sso/start 公开（无需 Bearer，302 到 IdP）', async () => {
    const res = await request(http)
      .get('/auth/sso/start')
      .redirects(0)
      .expect(302);
    expect(String(res.headers.location)).toContain('/oauth2/authorize');
  });

  it('GET /users/me 无 token 返回 401', async () => {
    await request(http).get('/users/me').expect(401);
  });

  it('GET /users/me 非法 token 返回 401', async () => {
    await request(http)
      .get('/users/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });

  it('GET /users/me 携带 JwtService 直签 token：用户不存在返回 401', async () => {
    const jwt = app.get(JwtService);
    const token = await jwt.signAsync({ sub: 'ghost-user', username: 'ghost' });
    await request(http)
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('GET / 健康检查无需鉴权', async () => {
    const res = await request(http).get('/').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
