import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  MATCH_STORE,
  MatchStore,
  USER_STORE,
  UserStore,
} from '../src/storage/stores';

describe('Matches & Leaderboard (e2e)', () => {
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

    // 直接经仓储种子 3 场对局（共 12 名玩家，验证 Top10 与总分聚合）
    const users: UserStore = app.get(USER_STORE);
    const matches: MatchStore = app.get(MATCH_STORE);
    const ids: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const u = await users.create({
        username: `player${i}`,
        passwordHash: 'x',
        avatarId: 1,
      });
      ids.push(u.id);
    }
    const day = 86_400_000;
    // 第 1 场（最早）：player1 得 300
    await matches.save({
      roomCode: 'AAA1',
      rounds: 6,
      endedAt: new Date(Date.now() - 2 * day),
      players: [{ userId: ids[0], username: 'player1', score: 300, rank: 1 }],
    });
    // 第 2 场：player2 得 250；player1 再得 100（累计 400）
    await matches.save({
      roomCode: 'BBB2',
      rounds: 6,
      endedAt: new Date(Date.now() - 1 * day),
      players: [
        { userId: ids[1], username: 'player2', score: 250, rank: 1 },
        { userId: ids[0], username: 'player1', score: 100, rank: 2 },
      ],
    });
    // 第 3 场（最新）：12 名玩家各 10 分
    await matches.save({
      roomCode: 'CCC3',
      rounds: 6,
      endedAt: new Date(),
      players: ids.map((id, i) => ({
        userId: id,
        username: `player${i + 1}`,
        score: 10,
        rank: i + 1,
      })),
    });

    const res = await request(http)
      .post('/auth/register')
      .send({ username: 'statviewer', password: 'secret1' })
      .expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /matches/recent 无 token 返回 401', async () => {
    await request(http).get('/matches/recent').expect(401);
  });

  it('GET /matches/recent 返回最近对局（新→旧，含玩家分数与排名）', async () => {
    const res = await request(http)
      .get('/matches/recent')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0].roomCode).toBe('CCC3');
    expect(res.body[0].players).toHaveLength(12);
    expect(res.body[0].players[0]).toMatchObject({
      username: expect.any(String),
      score: 10,
      rank: expect.any(Number),
    });
    expect(res.body[2].roomCode).toBe('AAA1');
    expect(res.body[2].players[0]).toMatchObject({
      username: 'player1',
      score: 300,
      rank: 1,
    });
    // limit 参数生效
    const capped = await request(http)
      .get('/matches/recent?limit=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(capped.body.length).toBe(2);
  });

  it('GET /leaderboard 无 token 返回 401', async () => {
    await request(http).get('/leaderboard').expect(401);
  });

  it('GET /leaderboard 按总分 Top10（player1=400 居首）', async () => {
    const res = await request(http)
      .get('/leaderboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.length).toBe(10);
    expect(res.body[0]).toMatchObject({
      username: 'player1',
      totalScore: 410, // 300 + 100 + 10（第 3 场每人 10 分）
    });
    expect(res.body[1]).toMatchObject({
      username: 'player2',
      totalScore: 260, // 250 + 10
    });
    // 分数降序
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i - 1].totalScore).toBeGreaterThanOrEqual(
        res.body[i].totalScore,
      );
    }
    // 其余玩家均为 10 分
    expect(res.body[2].totalScore).toBe(10);
  });
});
