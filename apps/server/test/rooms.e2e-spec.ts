import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Rooms REST (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = app.getHttpServer();
    const res = await request(http)
      .post('/auth/register')
      .send({ username: 'roomowner', password: 'secret1' })
      .expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /rooms 无 token 返回 401', async () => {
    await request(http).post('/rooms').expect(401);
  });

  it('POST /rooms 创建房间返回 4 位房间码', async () => {
    const res = await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(res.body.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(res.body.status).toBe('waiting');
    expect(res.body.maxPlayers).toBe(8);
    expect(res.body.rounds).toBe(6);
    expect(res.body.roundSeconds).toBe(80);
    expect(res.body.players).toEqual([]);
  });

  it('GET /rooms/:code 返回房间快照（刷新恢复）', async () => {
    const created = await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const snap = await request(http)
      .get(`/rooms/${created.body.code}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(snap.body.code).toBe(created.body.code);
    expect(snap.body).toHaveProperty('strokes');
    expect(snap.body).toHaveProperty('players');
    expect(snap.body).toHaveProperty('drawerId');
  });

  it('GET /rooms/:code 不存在返回 404', async () => {
    await request(http)
      .get('/rooms/ZZZZ')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /rooms/:code 无 token 返回 401', async () => {
    await request(http).get('/rooms/ABCD').expect(401);
  });
});
