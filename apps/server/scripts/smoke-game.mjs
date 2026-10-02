#!/usr/bin/env node
/**
 * Socket 网关冒烟测试（对应规格手测清单的后端全链路）：
 * 握手 JWT 拒绝 → 注册/建房 → 双客户端 join → game:start →
 * round:start（画者有词+类别/其他人只有字数）→ 笔迹转发 → 越权绘画报错 →
 * 错误猜词 → 正确猜词(guess:correct) → 全员猜中触发 round:end →
 * 回合轮换 → 断线保留（画者/猜词者 close 后重连，分数与玩家列表不丢）。
 * 用法：npm run build -w apps/server && node scripts/smoke-game.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const PORT = 3105;
const BASE = `http://127.0.0.1:${PORT}`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(scriptDir, '..');

const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name} ${extra}`);
  }
}

function waitEvent(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout waiting for ${event}`)),
      timeoutMs,
    );
    socket.once(event, (...args) => {
      clearTimeout(t);
      resolve(args[0]);
    });
  });
}

async function api(pathname, body, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitHealthy(timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('server did not become healthy');
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {});
child.stderr.on('data', (d) => process.stderr.write(d));

const sockets = [];
function connect(token) {
  const s = io(`${BASE}/game`, {
    auth: token ? { token } : {},
    reconnection: false,
    timeout: 4000,
  });
  sockets.push(s);
  return s;
}

try {
  await waitHealthy();

  const suffix = String(Date.now()).slice(-5);
  const regA = await api('/auth/register', {
    username: `smokea${suffix}`,
    password: 'secret1',
    avatarId: 2,
  });
  const regB = await api('/auth/register', {
    username: `smokeb${suffix}`,
    password: 'secret1',
  });
  check('register A', regA.status === 201, String(regA.status));
  check('register B', regB.status === 201, String(regB.status));
  const tokenA = regA.data.accessToken;
  const tokenB = regB.data.accessToken;

  const room = await api('/rooms', {}, tokenA);
  check('create room', room.status === 201 && /^[A-Z2-9]{4}$/.test(room.data.code), JSON.stringify(room.data));
  const code = room.data.code;

  // 1) 无 JWT 的握手应被拒绝
  {
    const bad = connect('');
    const outcome = await Promise.race([
      waitEvent(bad, 'connect_error', 5000).then((e) => ({ kind: 'connect_error', e })),
      waitEvent(bad, 'disconnect', 5000).then((e) => ({ kind: 'disconnect', e })),
      new Promise((r) => setTimeout(() => r({ kind: 'none' }), 5200)),
    ]);
    check(
      'handshake without JWT rejected',
      outcome.kind === 'connect_error' || outcome.kind === 'disconnect',
      JSON.stringify(outcome),
    );
    bad.close();
  }

  const sa = connect(tokenA);
  const sb = connect(tokenB);
  await Promise.all([waitEvent(sa, 'connect'), waitEvent(sb, 'connect')]);
  check('both clients connected', true);

  const stateAP = waitEvent(sa, 'room:state');
  sa.emit('room:join', { code });
  const stateA = await stateAP;
  check('A room:state has code+strokes', stateA?.code === code && Array.isArray(stateA?.strokes));

  const joinedP = waitEvent(sa, 'player:joined');
  const stateBP = waitEvent(sb, 'room:state');
  sb.emit('room:join', { code });
  const stateB = await stateBP;
  const joined = await joinedP;
  check('B room:state players=2', stateB?.players?.length === 2);
  check('A got player:joined', joined?.player?.userId === regB.data.user.id);

  // 房主才可开始：B 先试应报错
  const startErrP = waitEvent(sb, 'error');
  sb.emit('game:start');
  const startErr = await startErrP;
  check('game:start by non-owner rejected', String(startErr?.message).includes('房主'), JSON.stringify(startErr));

  const timers = { a: [], b: [] };
  sa.on('timer', (t) => timers.a.push(t));
  sb.on('timer', (t) => timers.b.push(t));
  const startedAP = waitEvent(sa, 'game:started');
  const startedBP = waitEvent(sb, 'game:started');
  const roundAP = waitEvent(sa, 'round:start');
  const roundBP = waitEvent(sb, 'round:start');
  sa.emit('game:start');
  await Promise.all([startedAP, startedBP]);
  const roundA = await roundAP;
  const roundB = await roundBP;
  check('game:started broadcast', true);
  check('drawer A received word', typeof roundA?.word === 'string' && roundA.word.length >= 2, JSON.stringify(roundA));
  check('drawer A received category', typeof roundA?.category === 'string' && roundA.category.length > 0, JSON.stringify(roundA));
  check('guesser B got charCount only', roundB?.word === undefined && roundB?.category === undefined && roundB?.charCount === roundA?.word?.length, JSON.stringify(roundB));
  check('roundNo=1 drawerId=A', roundA?.roundNo === 1 && roundA?.drawerId === regA.data.user.id);

  // 笔迹：A 画 → B 收到；B 画 → error
  const strokeP = waitEvent(sb, 'stroke');
  sa.emit('stroke', { x: 0.5, y: 0.25, color: '#FF6FA5', width: 3, down: true });
  const stroke = await strokeP;
  check('stroke forwarded to B', stroke?.x === 0.5 && stroke?.color === '#FF6FA5', JSON.stringify(stroke));

  const strokeErrP = waitEvent(sb, 'error');
  sb.emit('stroke', { x: 0.1, y: 0.1, color: '#000', width: 1, down: true });
  const strokeErr = await strokeErrP;
  check('stroke by non-drawer rejected', String(strokeErr?.message).includes('画者'), JSON.stringify(strokeErr));

  // 猜词：错误 → 私有系统提示；画者猜词 → error；正确 → guess:correct + round:end
  const wrongChatP = waitEvent(sb, 'chat');
  sb.emit('guess', { text: '完全不对的词' });
  const wrongChat = await wrongChatP;
  check('wrong guess private system chat', wrongChat?.playerId === null && String(wrongChat?.text).includes('猜错'), JSON.stringify(wrongChat));

  const drawerGuessErrP = waitEvent(sa, 'error');
  sa.emit('guess', { text: roundA.word });
  const drawerGuessErr = await drawerGuessErrP;
  check('drawer cannot guess', String(drawerGuessErr?.message).includes('画者不能猜词'), JSON.stringify(drawerGuessErr));

  const correctP = waitEvent(sa, 'guess:correct');
  const roundEndP = waitEvent(sa, 'round:end');
  sb.emit('guess', { text: `  ${roundA.word} ` }); // 带空格也应命中
  const correct = await correctP;
  check('guess:correct emitted', correct?.playerId === regB.data.user.id && correct?.gained >= 10, JSON.stringify(correct));
  const roundEnd = await roundEndP;
  check('round:end on all guessed', roundEnd?.word === roundA.word && roundEnd?.scores?.length === 2, JSON.stringify(roundEnd));
  const bScore = roundEnd?.scores?.find((s) => s.userId === regB.data.user.id);
  const aScore = roundEnd?.scores?.find((s) => s.userId === regA.data.user.id);
  check('B gained >= 10', bScore?.gained >= 10 && bScore?.total === bScore?.gained, JSON.stringify(bScore));
  check('A drawer 25% floor', aScore?.gained === Math.floor(bScore?.gained * 0.25), JSON.stringify(aScore));

  check('timer events received', timers.a.length >= 0 && roundA.endsAt > 0);

  // 回合间暂停 5s 后进入第 2 回合（轮换画者为 B）
  const round2P = waitEvent(sa, 'round:start', 8000);
  const roundB2FirstP = waitEvent(sb, 'round:start', 8000);
  const round2 = await round2P;
  const roundB2First = await roundB2FirstP;
  check('round 2 drawer rotates to B', round2?.roundNo === 2 && round2?.drawerId === regB.data.user.id, JSON.stringify(round2));

  // ---- 断线保留与重连（刷新恢复）----
  // B 是本回合画者：close 模拟刷新，服务端应保留玩家与分数并广播系统提示
  const disconnectChatP = waitEvent(sa, 'chat', 6000);
  sb.close();
  const disconnectChat = await disconnectChatP;
  check(
    'disconnect keeps player with notice',
    String(disconnectChat?.text).includes('连接中断') && String(disconnectChat?.text).includes('smokeb'),
    JSON.stringify(disconnectChat),
  );

  const sb2 = connect(tokenB);
  await waitEvent(sb2, 'connect');
  const stateB2P = waitEvent(sb2, 'room:state');
  const roundB2P = waitEvent(sb2, 'round:start');
  sb2.emit('room:join', { code });
  const stateB2 = await stateB2P;
  const bAfter = stateB2?.players?.find((p) => p.userId === regB.data.user.id);
  check('B reconnect: both players retained', stateB2?.players?.length === 2, JSON.stringify(stateB2?.players));
  check('B reconnect: score retained', bAfter?.score === bScore?.total, JSON.stringify(bAfter));
  check('B reconnect: still playing', stateB2?.status === 'playing', String(stateB2?.status));
  const roundB2 = await roundB2P;
  check(
    'B reconnect (drawer) gets word+category again',
    roundB2?.word === roundB2First?.word &&
      typeof roundB2?.word === 'string' &&
      roundB2?.category === roundB2First?.category &&
      typeof roundB2?.category === 'string' &&
      roundB2?.drawerId === regB.data.user.id,
    JSON.stringify(roundB2),
  );

  // A（猜词者）同样断线重连：分数与在场状态不丢
  const disconnectChat2P = waitEvent(sb2, 'chat', 6000);
  sa.close();
  const disconnectChat2 = await disconnectChat2P;
  check('guesser disconnect notice', String(disconnectChat2?.text).includes('连接中断'), JSON.stringify(disconnectChat2));

  const sa2 = connect(tokenA);
  await waitEvent(sa2, 'connect');
  const stateA2P = waitEvent(sa2, 'room:state');
  sa2.emit('room:join', { code });
  const stateA2 = await stateA2P;
  const aAfter = stateA2?.players?.find((p) => p.userId === regA.data.user.id);
  check('A reconnect: both players retained', stateA2?.players?.length === 2, JSON.stringify(stateA2?.players));
  check('A reconnect: score retained', aAfter?.score === aScore?.total, JSON.stringify(aAfter));
  check('A reconnect: B still drawer', stateA2?.drawerId === regB.data.user.id, String(stateA2?.drawerId));

  console.log(failures.length === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED: ${failures.join(' | ')}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
} catch (err) {
  console.error('SMOKE ERROR', err);
  process.exitCode = 1;
} finally {
  for (const s of sockets) {
    s.close();
  }
  child.kill();
}
