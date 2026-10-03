#!/usr/bin/env node
/**
 * Socket 网关冒烟测试（对应规格手测清单的后端全链路）：
 * 1) classic 回归：握手 JWT 拒绝 → 直签令牌建房 → 双客户端 join → game:start →
 *    round:start（画者有词+类别/其他人只有字数）→ 笔迹转发 → 越权绘画报错 →
 *    错误猜词 → 正确猜词(guess:correct) → 全员猜中触发 round:end →
 *    回合轮换 → 断线保留（画者/猜词者 close 后重连，分数与玩家列表不丢）。
 * 2) chain 段（2 人 byPlayers=2）：A 画 → B（指定猜词者）输入 xyz →
 *    chain:end（segments/wordTrail/replay）→ 双端投票 vote:result →
 *    下一条链 B 作画且题目=xyz → A 猜中 → 第二条链 chain:end/投票 → game:end。
 * 密码注册已移除：测试令牌由本脚本以 JWT_SECRET 直签（与服务端约定一致）。
 * 用法：npm run build -w apps/server && node scripts/smoke-game.mjs
 */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const PORT = 3105;
const BASE = `http://127.0.0.1:${PORT}`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(scriptDir, '..');

const JWT_SECRET = 'smoke-secret'; // 与 spawn env 一致
const SUB_A = 'smoke-a';
const SUB_B = 'smoke-b';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name} ${extra}`);
  }
}

/** HS256 直签（服务端 JWT_SECRET 由 spawn env 指定）。 */
function signToken({ sub, username, publicId, avatarId }) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub,
    username,
    publicId,
    avatarId,
    iat: now,
    exp: now + 7 * 24 * 3600,
  })}`;
  const sig = createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
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
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET,
    // 本地 SSO 配置不干扰冒烟（登录流程不经 SSO）
    SSO_ISSUER: 'http://127.0.0.1:8080',
  },
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

  const tokenA = signToken({
    sub: SUB_A,
    username: 'smokea',
    avatarId: 2,
    publicId: 1,
  });
  const tokenB = signToken({
    sub: SUB_B,
    username: 'smokeb',
    avatarId: 1,
    publicId: 2,
  });
  check('sign tokens without register', tokenA.split('.').length === 3);

  const room = await api('/rooms', {}, tokenA);
  check(
    'create room (6-char code, defaults)',
    room.status === 201 &&
      CODE_RE.test(room.data.code) &&
      room.data.orderRule === 'id' &&
      room.data.drawRule === 'classic' &&
      room.data.totalRounds === 6,
    JSON.stringify(room.data),
  );
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
  check('A got player:joined', joined?.player?.userId === SUB_B);

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
  check('roundNo=1 drawerId=A', roundA?.roundNo === 1 && roundA?.drawerId === SUB_A, JSON.stringify(roundA));

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
  check('guess:correct emitted', correct?.playerId === SUB_B && correct?.gained >= 10, JSON.stringify(correct));
  const roundEnd = await roundEndP;
  check('round:end on all guessed', roundEnd?.word === roundA.word && roundEnd?.scores?.length === 2, JSON.stringify(roundEnd));
  check('classic round:end has no chain fields', roundEnd?.passedText === undefined && roundEnd?.wordTrail === undefined, JSON.stringify(roundEnd));
  const bScore = roundEnd?.scores?.find((s) => s.userId === SUB_B);
  const aScore = roundEnd?.scores?.find((s) => s.userId === SUB_A);
  check('B gained >= 10', bScore?.gained >= 10 && bScore?.total === bScore?.gained, JSON.stringify(bScore));
  check('A drawer 25% floor', aScore?.gained === Math.floor(bScore?.gained * 0.25), JSON.stringify(aScore));

  check('timer events received', timers.a.length >= 0 && roundA.endsAt > 0);

  // 回合间暂停 5s 后进入第 2 回合（轮换画者为 B）
  const round2P = waitEvent(sa, 'round:start', 8000);
  const roundB2FirstP = waitEvent(sb, 'round:start', 8000);
  const round2 = await round2P;
  const roundB2First = await roundB2FirstP;
  check('round 2 drawer rotates to B', round2?.roundNo === 2 && round2?.drawerId === SUB_B, JSON.stringify(round2));

  // ---- 断线保留与重连（刷新恢复）----
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
  const bAfter = stateB2?.players?.find((p) => p.userId === SUB_B);
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
      roundB2?.drawerId === SUB_B,
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
  const aAfter = stateA2?.players?.find((p) => p.userId === SUB_A);
  check('A reconnect: both players retained', stateA2?.players?.length === 2, JSON.stringify(stateA2?.players));
  check('A reconnect: score retained', aAfter?.score === aScore?.total, JSON.stringify(aAfter));
  check('A reconnect: B still drawer', stateA2?.drawerId === SUB_B, String(stateA2?.drawerId));

  // ============================================================
  // chain 段：2 人、orderRule=id、drawRule=chain、rounds=byPlayers(2)
  // ============================================================
  console.log('\n--- chain 段 ---');
  const chainRoom = await api(
    '/rooms',
    { orderRule: 'id', drawRule: 'chain', rounds: { mode: 'byPlayers' } },
    tokenA,
  );
  check(
    'create chain room (rules + byPlayers totalRounds=null)',
    chainRoom.status === 201 &&
      CODE_RE.test(chainRoom.data.code) &&
      chainRoom.data.drawRule === 'chain' &&
      chainRoom.data.orderRule === 'id' &&
      JSON.stringify(chainRoom.data.rounds) === JSON.stringify({ mode: 'byPlayers' }) &&
      chainRoom.data.totalRounds === null,
    JSON.stringify(chainRoom.data),
  );
  const chainCode = chainRoom.data.code;

  const ca = connect(tokenA);
  const cb = connect(tokenB);
  await Promise.all([waitEvent(ca, 'connect'), waitEvent(cb, 'connect')]);

  const caStateP = waitEvent(ca, 'room:state');
  ca.emit('room:join', { code: chainCode });
  const caState = await caStateP;
  check(
    'chain room:state carries rules + 链式态',
    caState?.drawRule === 'chain' &&
      caState?.orderRule === 'id' &&
      caState?.totalRounds === null &&
      caState?.guesserId === null &&
      caState?.chainIndex === undefined,
    JSON.stringify(caState),
  );
  const cbStateP = waitEvent(cb, 'room:state');
  cb.emit('room:join', { code: chainCode });
  await cbStateP;

  const cStartedAP = waitEvent(ca, 'game:started');
  const cStartedBP = waitEvent(cb, 'game:started');
  const cRoundAP = waitEvent(ca, 'round:start');
  const cRoundBP = waitEvent(cb, 'round:start');
  ca.emit('game:start');
  const cStartedA = await cStartedAP;
  await cStartedBP;
  check(
    'chain game:started resolves byPlayers → 2',
    cStartedA?.rounds === 2 && cStartedA?.drawRule === 'chain',
    JSON.stringify(cStartedA),
  );
  const seg1A = await cRoundAP;
  const seg1B = await cRoundBP;
  check(
    'chain seg1: A 画 / B 指定猜词（链序按 publicId 升序）',
    seg1A?.drawerId === SUB_A &&
      seg1A?.guesserId === SUB_B &&
      seg1A?.chainIndex === 1 &&
      seg1A?.chainTotal === 2,
    JSON.stringify(seg1A),
  );
  check(
    'chain seg1: A 有词+类别，B 只有字数',
    typeof seg1A?.word === 'string' &&
      typeof seg1A?.category === 'string' &&
      seg1B?.word === undefined &&
      seg1B?.charCount === seg1A.word.length,
    JSON.stringify({ seg1A, seg1B }),
  );

  // 非指定猜词者（画者 A）提交 → error 本回合由指定玩家猜词
  const rejectP = waitEvent(ca, 'error');
  ca.emit('guess', { text: 'abc' });
  const rejected = await rejectP;
  check(
    'non-designated guess rejected',
    String(rejected?.message).includes('本回合由指定玩家猜词'),
    JSON.stringify(rejected),
  );

  const cStrokeP = waitEvent(cb, 'stroke');
  ca.emit('stroke', { x: 0.3, y: 0.4, color: '#123456', width: 2, down: true });
  const cStroke = await cStrokeP;
  check('chain seg1 stroke A→B', cStroke?.x === 0.3, JSON.stringify(cStroke));

  // B（指定猜词者）输入 xyz → 单次提交结束本段，末条输入传导
  const end1P = waitEvent(ca, 'round:end', 8000);
  const end1BP = waitEvent(cb, 'round:end', 8000);
  cb.emit('guess', { text: 'xyz' });
  const end1 = await end1P;
  await end1BP;
  check(
    'round:end carries passedText=xyz + wordTrail',
    end1?.passedText === 'xyz' &&
      Array.isArray(end1?.wordTrail) &&
      end1.wordTrail[end1.wordTrail.length - 1] === 'xyz' &&
      typeof end1?.word === 'string',
    JSON.stringify(end1),
  );

  // 链完成（2 人单链 1 段）→ chain:end
  const chainEnd1P = waitEvent(ca, 'chain:end', 8000);
  const chainEnd1BP = waitEvent(cb, 'chain:end', 8000);
  const chainEnd1 = await chainEnd1P;
  await chainEnd1BP;
  check(
    'chain:end segments 元信息',
    chainEnd1?.segments?.length === 1 &&
      chainEnd1.segments[0].drawerId === SUB_A &&
      chainEnd1.segments[0].guesserId === SUB_B &&
      chainEnd1.segments[0].passedText === 'xyz' &&
      typeof chainEnd1.segments[0].prompt === 'string',
    JSON.stringify(chainEnd1?.segments),
  );
  check(
    'chain:end wordTrail=[词库词, xyz]',
    Array.isArray(chainEnd1?.wordTrail) &&
      chainEnd1.wordTrail.length === 2 &&
      chainEnd1.wordTrail[1] === 'xyz',
    JSON.stringify(chainEnd1?.wordTrail),
  );
  check(
    'chain:end replay 含本段笔迹',
    Array.isArray(chainEnd1?.replay) &&
      chainEnd1.replay.length === 1 &&
      chainEnd1.replay[0].roundNo === 1 &&
      chainEnd1.replay[0].strokes.length >= 1 &&
      typeof chainEnd1.replay[0].prompt === 'string',
    JSON.stringify(chainEnd1?.replay?.map((r) => r.strokes.length)),
  );

  // 双端投票（A 先投两次：重复忽略；再 B 投 → 聚合广播）
  const vr1P = waitEvent(ca, 'vote:result', 8000);
  const vr1BP = waitEvent(cb, 'vote:result', 8000);
  ca.emit('vote:cast', { choice: 1 });
  ca.emit('vote:cast', { choice: 1 }); // 重复 → 忽略
  cb.emit('vote:cast', { choice: 2 });
  const vr1 = await vr1P;
  await vr1BP;
  check(
    'vote:result counts（重复投票忽略）',
    vr1?.counts?.['1'] === 1 && vr1?.counts?.['2'] === 1 && vr1?.counts?.['3'] === 0,
    JSON.stringify(vr1),
  );
  check(
    'vote:result wordTrail 完整',
    Array.isArray(vr1?.wordTrail) && vr1.wordTrail[0] !== undefined && vr1.wordTrail[vr1.wordTrail.length - 1] === 'xyz',
    JSON.stringify(vr1?.wordTrail),
  );

  // 下一条链（offset+1）：B 作画，题目 = 传导文本 xyz
  const seg2AP = waitEvent(ca, 'round:start', 8000);
  const seg2BP = waitEvent(cb, 'round:start', 8000);
  const seg2A = await seg2AP;
  const seg2B = await seg2BP;
  check(
    'chain seg2（offset+1）: B 作画且题目=xyz、A 猜词、chainIndex=2',
    seg2A?.drawerId === SUB_B &&
      seg2A?.guesserId === SUB_A &&
      seg2A?.chainIndex === 2 &&
      seg2A?.chainTotal === 2,
    JSON.stringify(seg2A),
  );
  check(
    'chain seg2: 画者 B 收到传导题目 xyz',
    seg2B?.word === 'xyz' && seg2B?.category === undefined,
    JSON.stringify(seg2B),
  );

  const cStroke2P = waitEvent(ca, 'stroke');
  cb.emit('stroke', { x: 0.6, y: 0.7, color: '#654321', width: 5, down: true });
  await cStroke2P;
  check('chain seg2 stroke B→A', true);

  // A（指定猜词者）猜中 xyz → 结束本段
  const correct2P = waitEvent(ca, 'guess:correct', 8000);
  const end2P = waitEvent(ca, 'round:end', 8000);
  ca.emit('guess', { text: 'xyz' });
  const correct2 = await correct2P;
  const end2 = await end2P;
  check(
    'seg2 猜中得分',
    correct2?.playerId === SUB_A && correct2?.gained >= 10,
    JSON.stringify(correct2),
  );
  check(
    'seg2 round:end word=xyz passedText=xyz（wordTrail 去重）',
    end2?.word === 'xyz' &&
      end2?.passedText === 'xyz' &&
      end2?.wordTrail?.length === 2,
    JSON.stringify(end2),
  );

  // 第二条链完成 → chain:end → 投票 → 回合用尽（2/2）→ game:end
  const chainEnd2P = waitEvent(ca, 'chain:end', 8000);
  const chainEnd2 = await chainEnd2P;
  check(
    'chain2:end segments/replay 各 1、wordTrail 累积',
    chainEnd2?.segments?.length === 1 &&
      chainEnd2?.replay?.length === 1 &&
      Array.isArray(chainEnd2?.wordTrail) &&
      chainEnd2.wordTrail.length === 2,
    JSON.stringify(chainEnd2),
  );

  const vr2P = waitEvent(ca, 'vote:result', 8000);
  ca.emit('vote:cast', { choice: 3 });
  cb.emit('vote:cast', { choice: 3 });
  const vr2 = await vr2P;
  check(
    'vote:result2 counts {3:2}',
    vr2?.counts?.['3'] === 2,
    JSON.stringify(vr2),
  );

  const gameEndP = waitEvent(ca, 'game:end', 8000);
  const gameEnd = await gameEndP;
  check(
    'game:end after chain votes（回合并计 2/2）',
    gameEnd?.results?.length === 2 && typeof gameEnd?.reason === 'string',
    JSON.stringify(gameEnd),
  );

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
