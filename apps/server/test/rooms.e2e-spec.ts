import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

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
    const jwt = app.get(JwtService);
    token = await jwt.signAsync({
      sub: 'room-owner-1',
      username: 'roomowner',
      publicId: 1,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /rooms 无 token 返回 401', async () => {
    await request(http).post('/rooms').expect(401);
  });

  it('POST /rooms 默认规则：6 位邀请码、60 人上限、fixed6、totalRounds=6', async () => {
    const res = await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(res.body.code).toMatch(CODE_RE);
    expect(res.body.status).toBe('waiting');
    expect(res.body.maxPlayers).toBe(60);
    expect(res.body.orderRule).toBe('id');
    expect(res.body.drawRule).toBe('classic');
    expect(res.body.rounds).toEqual({ mode: 'fixed', value: 6 });
    expect(res.body.totalRounds).toBe(6);
    expect(res.body.roundSeconds).toBe(80);
    expect(res.body.players).toEqual([]);
  });

  it('POST /rooms 自定义规则回显（chain/roundShuffle/byPlayers 开局前 totalRounds=null）', async () => {
    const res = await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderRule: 'roundShuffle',
        drawRule: 'chain',
        rounds: { mode: 'byPlayers' },
      })
      .expect(201);
    expect(res.body.orderRule).toBe('roundShuffle');
    expect(res.body.drawRule).toBe('chain');
    expect(res.body.rounds).toEqual({ mode: 'byPlayers' });
    expect(res.body.totalRounds).toBeNull();
  });

  it('POST /rooms custom 缺 value 返回 400；value 越界返回 400；非法枚举 400', async () => {
    await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ rounds: { mode: 'custom' } })
      .expect(400);
    await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ rounds: { mode: 'custom', value: 61 } })
      .expect(400);
    await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderRule: 'random' })
      .expect(400);
  });

  it('POST /rooms fixed 指定 value 生效', async () => {
    const res = await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ rounds: { mode: 'fixed', value: 3 } })
      .expect(201);
    expect(res.body.rounds).toEqual({ mode: 'fixed', value: 3 });
    expect(res.body.totalRounds).toBe(3);
  });

  it('GET /rooms/:code 返回房间快照（含规则与链式态字段）', async () => {
    const created = await request(http)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ drawRule: 'chain', rounds: { mode: 'custom', value: 2 } })
      .expect(201);
    const snap = await request(http)
      .get(`/rooms/${created.body.code}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(snap.body.code).toBe(created.body.code);
    expect(snap.body).toHaveProperty('strokes');
    expect(snap.body).toHaveProperty('players');
    expect(snap.body).toHaveProperty('drawerId');
    expect(snap.body).toHaveProperty('phase');
    expect(snap.body.drawRule).toBe('chain');
    expect(snap.body.guesserId).toBeNull();
    expect(snap.body.totalRounds).toBe(2);
  });

  it('GET /rooms/:code 不存在返回 404', async () => {
    await request(http)
      .get('/rooms/ZZZZZZ')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /rooms/:code 无 token 返回 401', async () => {
    await request(http).get('/rooms/ABCDEF').expect(401);
  });
});
