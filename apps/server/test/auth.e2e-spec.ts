import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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

  it('POST /auth/register 注册成功并返回 accessToken 与 user（默认 avatarId=1）', async () => {
    const res = await request(http)
      .post('/auth/register')
      .send({ username: 'alice', password: 'secret1' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user).toMatchObject({
      username: 'alice',
      avatarId: 1,
    });
    expect(typeof res.body.user.id).toBe('string');
  });

  it('POST /auth/register 重复用户名返回 409', async () => {
    await request(http)
      .post('/auth/register')
      .send({ username: 'alice', password: 'secret1' })
      .expect(409);
  });

  it('POST /auth/register 带 avatarId 注册后 users-me 返回该值', async () => {
    const reg = await request(http)
      .post('/auth/register')
      .send({ username: 'bob', password: 'secret1', avatarId: 4 })
      .expect(201);
    expect(reg.body.user.avatarId).toBe(4);
    const me = await request(http)
      .get('/users/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ username: 'bob', avatarId: 4 });
  });

  it('POST /auth/register avatarId 越界返回 400', async () => {
    await request(http)
      .post('/auth/register')
      .send({ username: 'badavatar', password: 'secret1', avatarId: 7 })
      .expect(400);
    await request(http)
      .post('/auth/register')
      .send({ username: 'badavatar0', password: 'secret1', avatarId: 0 })
      .expect(400);
  });

  it('POST /auth/register 用户名/密码不合规返回 400', async () => {
    await request(http)
      .post('/auth/register')
      .send({ username: 'ab', password: 'secret1' })
      .expect(400);
    await request(http)
      .post('/auth/register')
      .send({ username: 'validname', password: '12345' })
      .expect(400);
  });

  it('POST /auth/login 登录成功', async () => {
    const res = await request(http)
      .post('/auth/login')
      .send({ username: 'alice', password: 'secret1' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.username).toBe('alice');
  });

  it('POST /auth/login 错误密码返回 401', async () => {
    await request(http)
      .post('/auth/login')
      .send({ username: 'alice', password: 'wrongpass' })
      .expect(401);
  });

  it('POST /auth/login 用户不存在返回 401', async () => {
    await request(http)
      .post('/auth/login')
      .send({ username: 'nobody', password: 'secret1' })
      .expect(401);
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

  it('GET /users/me 携带有效 token 返回当前用户', async () => {
    const login = await request(http)
      .post('/auth/login')
      .send({ username: 'alice', password: 'secret1' })
      .expect(201);
    const me = await request(http)
      .get('/users/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ username: 'alice', avatarId: 1 });
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('GET / 健康检查无需鉴权', async () => {
    const res = await request(http).get('/').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
