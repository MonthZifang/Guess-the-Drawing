#!/usr/bin/env node
/**
 * 26 人链式容量断言（评审 C1 回归）：
 * 26 人 = 13 段/链；逐段指定猜词者即时提交 → chain:end(replay=13)
 * → 全员 vote:cast → vote:result → game:end。
 * 覆盖「回放 13×2.5s=32.5s > 旧 30s 超时」修复后的投票可达性（服务端接受
 * 即时投票，全票路径不依赖超时；超时窗口已改为 回放估时+30s）。
 * 用法：先 build，node scripts/capacity-chain.mjs (cwd=apps/server)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const PORT = 3108;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = process.env.JWT_SECRET ?? 'guess-draw-anime-dev-secret';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(scriptDir, '..');
const N = 26;
const ROUNDS = 13; // 单链段数 = ceil(26/2)

const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.log(`FAIL  ${name} ${extra}`); }
};
const waitEvent = (s, ev, ms = 15000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    s.once(ev, (...a) => { clearTimeout(t); res(a[0]); });
  });
async function api(p, body, token) {
  const r = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write(d));

const token = (i) => jwt.sign(
  { sub: `chain-cap-${i}`, username: `链压测${i}`, avatarId: (i % 6) + 1 },
  SECRET,
  { expiresIn: '1h' },
);

const sockets = [];
try {
  for (let t = 0; ; t++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* wait */ }
    if (t > 60) throw new Error('server not healthy');
    await new Promise((r) => setTimeout(r, 300));
  }

  const room = await api('/rooms', {
    orderRule: 'id',
    drawRule: 'chain',
    rounds: { mode: 'fixed', value: ROUNDS },
  }, token(0));
  check('chain room created (13 rounds)', room.status === 201 && room.data.code, JSON.stringify(room.data));
  const code = room.data.code;

  const clients = [];
  const mySub = (i) => `chain-cap-${i}`;
  for (let i = 0; i < N; i++) {
    const s = io(`${BASE}/game`, { auth: { token: token(i) }, reconnection: false, timeout: 5000 });
    sockets.push(s);
    clients.push({ s, sub: mySub(i), i });
  }
  await Promise.all(clients.map((c) => waitEvent(c.s, 'connect', 8000)));
  check(`${N} chain clients connected`, true);

  let lastState = null;
  for (let i = 0; i < N; i += 10) {
    const batch = clients.slice(i, i + 10);
    const states = batch.map((c) => waitEvent(c.s, 'room:state', 8000));
    batch.forEach((c) => c.s.emit('room:join', { code }));
    const rs = await Promise.all(states);
    lastState = rs[rs.length - 1];
  }
  check('26 players in state', lastState?.players?.length === N, String(lastState?.players?.length));
  check('drawRule=chain in snapshot', lastState?.drawRule === 'chain', String(lastState?.drawRule));

  // 全程驱动：每个 round:start 由指定猜词者立即提交 → 段结束
  const chainEnds = [];
  const voteResults = [];
  const gameEnds = [];
  let roundStarts = 0;
  for (const c of clients) {
    c.s.on('round:start', (data) => {
      roundStarts += 1;
      if (data?.guesserId === c.sub) {
        setTimeout(() => c.s.emit('guess', { text: `传${c.i}` }), 30);
      }
    });
    c.s.on('chain:end', (d) => chainEnds.push(d));
    c.s.on('vote:result', (d) => voteResults.push(d));
    c.s.on('game:end', (d) => gameEnds.push(d));
  }

  clients[0].s.emit('game:start');
  await waitEvent(clients[0].s, 'game:started', 10000);

  const ce = await waitEvent(clients[0].s, 'chain:end', 120000);
  check('chain:end replay has 13 segments', Array.isArray(ce?.replay) && ce.replay.length === ROUNDS, String(ce?.replay?.length));
  check('chain:end segments 13', Array.isArray(ce?.segments) && ce.segments.length === ROUNDS, String(ce?.segments?.length));
  check('wordTrail spans chain', Array.isArray(ce?.wordTrail) && ce.wordTrail.length >= 2, JSON.stringify(ce?.wordTrail));

  // 全员立即投票（服务端全票路径，不依赖超时）
  for (const c of clients) c.s.emit('vote:cast', { choice: (c.i % 3) + 1 });
  const vr = await waitEvent(clients[0].s, 'vote:result', 20000);
  const total = Object.values(vr?.counts ?? {}).reduce((a, b) => a + b, 0);
  check('vote:result counts all 26', total === N, JSON.stringify(vr?.counts));
  check('vote:result wordTrail', Array.isArray(vr?.wordTrail) && vr.wordTrail.length >= 2, '');

  const ge = await waitEvent(clients[0].s, 'game:end', 30000);
  check('game:end after single chain (13 rounds exhausted)', !!ge, '');
  check('all round:start delivered (13 rounds × 26 clients)', roundStarts >= ROUNDS * N, `got ${roundStarts}`);

  console.log(failures.length === 0 ? '\nCHAIN-CAPACITY OK' : `\nCHAIN-CAPACITY FAILED: ${failures.join(' | ')}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
} catch (e) {
  console.error('CHAIN-CAPACITY ERROR', e);
  process.exitCode = 1;
} finally {
  for (const s of sockets) s.close();
  child.kill();
}
