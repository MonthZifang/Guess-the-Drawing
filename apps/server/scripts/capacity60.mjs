#!/usr/bin/env node
/**
 * 60 人容量压测：60 个 socket 客户端加入同一房间并开局，
 * 验证 maxPlayers=60、全员收到 round:start、笔迹广播送达；
 * 第 61 人应被拒绝。用法：先 build，node scripts/capacity60.mjs (cwd=apps/server)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = process.env.JWT_SECRET ?? 'guess-draw-anime-dev-secret';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(scriptDir, '..');
const N = 60;

const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.log(`FAIL  ${name} ${extra}`); }
};
const waitEvent = (s, ev, ms = 8000) =>
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

const sockets = [];
const token = (i) => jwt.sign(
  { sub: `cap-${i}`, username: `玩家${i}`, avatarId: (i % 6) + 1 },
  SECRET,
  { expiresIn: '1h' },
);

try {
  for (let t = 0; ; t++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* wait */ }
    if (t > 60) throw new Error('server not healthy');
    await new Promise((r) => setTimeout(r, 300));
  }

  const room = await api('/rooms', { orderRule: 'id', drawRule: 'classic', rounds: { mode: 'fixed', value: 3 } }, token(0));
  check('create room (6-char code)', room.status === 201 && /^[A-Z2-9]{6}$/.test(room.data.code), JSON.stringify(room.data));
  const code = room.data.code;

  const clients = [];
  for (let i = 0; i < N; i++) {
    const s = io(`${BASE}/game`, { auth: { token: token(i) }, reconnection: false, timeout: 5000 });
    sockets.push(s);
    clients.push(s);
  }
  await Promise.all(clients.map((s) => waitEvent(s, 'connect', 8000)));
  check(`${N} clients connected`, true);

  // 全员 join（逐个以获得稳定 state 断言；并发亦可，这里分批 10 个）
  let lastState = null;
  for (let i = 0; i < N; i += 10) {
    const batch = clients.slice(i, i + 10);
    const states = batch.map((s) => waitEvent(s, 'room:state', 8000));
    batch.forEach((s) => s.emit('room:join', { code }));
    const rs = await Promise.all(states);
    lastState = rs[rs.length - 1];
  }
  check(`room state has ${N} players`, lastState?.players?.length === N, `got ${lastState?.players?.length}`);
  check('snapshot maxPlayers=60', lastState?.maxPlayers === 60, String(lastState?.maxPlayers));

  // 第 61 人应被拒绝
  const s61 = io(`${BASE}/game`, { auth: { token: token(999) }, reconnection: false, timeout: 5000 });
  sockets.push(s61);
  await waitEvent(s61, 'connect', 8000);
  const errP = waitEvent(s61, 'error', 6000);
  s61.emit('room:join', { code });
  const err = await errP;
  check('61st player rejected', String(err?.message).includes('满'), JSON.stringify(err));
  s61.close();

  // 开局：全员应收到 game:started + round:start
  const startedAll = Promise.all(clients.map((s) => waitEvent(s, 'game:started', 10000)));
  const roundAll = Promise.all(clients.map((s) => waitEvent(s, 'round:start', 10000)));
  clients[0].emit('game:start');
  await startedAll;
  const rounds = await roundAll;
  check('all clients received game:started', true);
  check('all clients received round:start', rounds.length === N, String(rounds.length));

  // 画者（链序 id：sub 排序 cap-0 → 玩家0？id 规则按 publicId??sub 字符串排序——
  // 以 round:start 中的 drawerId 为准）
  const drawerId = rounds[0]?.drawerId;
  let dSock = null;
  for (let i = 0; i < N; i++) {
    if (drawerId === `cap-${i}`) { dSock = clients[i]; break; }
  }
  check('drawer socket located', dSock !== null, String(drawerId));

  const gotStroke = new Array(N).fill(0);
  clients.forEach((s, i) => s.on('stroke', () => { gotStroke[i] = 1; }));
  dSock.emit('stroke', { x: 0.3, y: 0.4, color: '#FF6FA5', width: 3, down: true });
  await new Promise((r) => setTimeout(r, 1500));
  const received = gotStroke.reduce((a, b) => a + b, 0);
  check(`stroke broadcast received (expect ${N - 1})`, received >= N - 1, `got ${received}`);

  console.log(failures.length === 0 ? '\nCAPACITY OK' : `\nCAPACITY FAILED: ${failures.join(' | ')}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
} catch (e) {
  console.error('CAPACITY ERROR', e);
  process.exitCode = 1;
} finally {
  for (const s of sockets) s.close();
  child.kill();
}
