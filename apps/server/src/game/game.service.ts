import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import {
  MATCH_STORE,
  MatchStore,
  USER_STORE,
  WordStore,
  WORD_STORE,
  UserStore,
} from '../storage/stores';
import { normalizeCode, RoomRegistry } from '../rooms/room.registry';
import {
  ChainSegmentMeta,
  Room,
  RoomPlayer,
  ROUND_PAUSE_MS,
  Stroke,
  VOTE_TIMEOUT_MS,
} from '../rooms/room.types';
import { roomSnapshot } from '../rooms/rooms.controller';
import {
  computeRanks,
  drawerScore,
  guesserScore,
  normalizeGuessText,
} from './scoring';
import {
  buildChainOrder,
  createRotation,
  nextDrawer,
  resolveRounds,
  rotateChain,
  RotationPlayer,
} from './rotation';
import {
  appendWordTrail,
  chainPairs,
  guessRejection,
  passPrompt,
  segmentCount,
} from './chain';

interface HandshakeUser {
  sub: string;
  username: string;
  avatarId?: number;
  publicId?: number | null;
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private server: Namespace | null = null;

  constructor(
    @Inject(WORD_STORE) private readonly words: WordStore,
    @Inject(MATCH_STORE) private readonly matches: MatchStore,
    @Inject(USER_STORE) private readonly users: UserStore,
    private readonly registry: RoomRegistry,
  ) {}

  attach(server: Namespace): void {
    this.server = server;
  }

  // ---------- 连接生命周期 ----------

  async handleJoin(socket: Socket, body: unknown): Promise<void> {
    const code = normalizeCode(extractCode(body));
    if (!code) {
      return this.err(socket, '缺少房间码');
    }
    const room = this.registry.get(code);
    if (!room) {
      return this.err(socket, '房间不存在或房间码非法');
    }
    const user = socket.data.user as HandshakeUser | undefined;
    if (!user) {
      return this.err(socket, '未授权');
    }
    const profile = await this.users.findById(user.sub);
    let player = room.players.find((p) => p.userId === user.sub);
    if (player) {
      // 刷新重连：顶替旧 socket
      if (player.socketId && player.socketId !== socket.id) {
        this.server?.sockets.get(player.socketId)?.leave(room.code);
      }
      player.socketId = socket.id;
      if (profile) {
        player.username = profile.username;
        player.avatarId = profile.avatarId;
        player.publicId = profile.publicId;
      }
    } else {
      if (room.players.length >= room.maxPlayers) {
        return this.err(socket, `房间已满（最多 ${room.maxPlayers} 人）`);
      }
      player = {
        userId: user.sub,
        username: profile?.username ?? user.username,
        avatarId: profile?.avatarId ?? user.avatarId ?? 1,
        publicId: profile?.publicId ?? user.publicId ?? null,
        socketId: socket.id,
        joinedAt: Date.now(),
        score: 0,
        guessed: false,
        roundGained: 0,
      };
      room.players.push(player);
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;

    socket.emit('room:state', roomSnapshot(room, user.sub));
    socket
      .to(room.code)
      .emit('player:joined', { player: publicPlayer(player) });
    this.systemChat(
      room.code,
      `${player.username} 加入了房间（${room.players.length}/${room.maxPlayers}）`,
    );
    if (room.status === 'playing' && room.phase === 'round') {
      this.sendRoundStartTo(socket, room);
    }
  }

  handleLeave(socket: Socket): void {
    this.removePlayer(socket, 'leave');
  }

  handleDisconnect(socket: Socket): void {
    const code = socket.data.roomCode as string | undefined;
    const user = socket.data.user as HandshakeUser | undefined;
    const room = code ? this.registry.get(code) : undefined;
    if (code && room && user && room.status === 'playing') {
      // 对局中刷新/掉线：保留玩家与分数，等待重连（规格：快照用于刷新恢复）
      const player = room.players.find(
        (p) => p.userId === user.sub && p.socketId === socket.id,
      );
      if (player) {
        player.socketId = null;
        socket.data.roomCode = undefined;
        socket.leave(code);
        this.systemChat(room.code, `${player.username} 连接中断，等待重连…`);
        return;
      }
    }
    this.removePlayer(socket, 'disconnect');
  }

  private removePlayer(socket: Socket, reason: 'leave' | 'disconnect'): void {
    const code = socket.data.roomCode as string | undefined;
    if (!code) {
      return;
    }
    socket.data.roomCode = undefined;
    socket.leave(code);
    const room = this.registry.get(code);
    if (!room) {
      return;
    }
    const idx = room.players.findIndex(
      (p) => p.socketId === socket.id && p.userId === (socket.data.user as HandshakeUser)?.sub,
    );
    if (idx < 0) {
      return;
    }
    const [left] = room.players.splice(idx, 1);
    socket.to(room.code).emit('player:left', {
      userId: left.userId,
      username: left.username,
      reason,
    });
    this.systemChat(room.code, `${left.username} 离开了房间`);

    if (room.players.length === 0) {
      this.registry.delete(room.code);
      return;
    }
    if (room.ownerId === left.userId) {
      room.ownerId = room.players[0].userId;
      this.systemChat(room.code, `房主转移给 ${room.players[0].username}`);
    }
    if (room.status !== 'playing') {
      return;
    }
    if (room.players.length < 2) {
      void this.endMatch(room, '人数不足，对局提前结束');
      return;
    }
    // 投票中有人离场：剩余全员已投则立即结算
    if (
      room.phase === 'vote' &&
      room.chain &&
      room.chain.votes.size >= room.players.length
    ) {
      this.finalizeVote(room);
      return;
    }
    if (room.phase !== 'round') {
      return; // 回合间暂停：留给下一回合
    }
    if (left.userId === room.drawerId) {
      this.endRound(room, '画者离开');
    } else if (this.allGuessed(room)) {
      this.endRound(room, '全员猜中');
    }
  }

  // ---------- 对局控制 ----------

  handleStart(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room) {
      return;
    }
    const user = socket.data.user as HandshakeUser;
    if (room.ownerId !== user.sub) {
      return this.err(socket, '只有房主可以开始游戏');
    }
    if (room.status !== 'waiting') {
      return this.err(socket, '对局已经开始');
    }
    if (room.players.length < 2) {
      return this.err(socket, '至少需要 2 名玩家才能开始');
    }
    room.status = 'playing';
    room.roundNo = 0;
    room.usedWordTexts.clear();
    for (const p of room.players) {
      p.score = 0;
      p.guessed = false;
      p.roundGained = 0;
    }
    // byPlayers 在 game:start 时按当时人数解析
    room.totalRounds = resolveRounds(room.roundsSpec, room.players.length);
    const rotationPlayers: RotationPlayer[] = room.players.map((p) => ({
      userId: p.userId,
      publicId: p.publicId,
    }));
    room.rotation = createRotation(rotationPlayers, room.orderRule);
    room.guesserId = null;
    if (room.drawRule === 'chain') {
      // 链序开局生成一次；offset+1 换链
      const order = buildChainOrder(rotationPlayers, room.orderRule);
      const fullLen = segmentCount(order.length);
      const total = room.totalRounds;
      room.chain = {
        order,
        offset: 0,
        chainIndex: 1,
        chainTotal: Math.max(1, Math.ceil(total / Math.max(1, fullLen))),
        fullLen,
        segTotal: Math.min(fullLen, total),
        segUsed: 0,
        segments: [],
        history: [],
        replay: [],
        trail: [],
        votes: new Map(),
        globalSeg: 0,
      };
    } else {
      room.chain = null;
    }
    this.server?.to(room.code).emit('game:started', {
      rounds: room.totalRounds,
      roundSeconds: room.roundSeconds,
      drawRule: room.drawRule,
      orderRule: room.orderRule,
      players: room.players.map(publicPlayer),
    });
    this.startRound(room);
  }

  private startRound(room: Room): void {
    if (room.status !== 'playing' || room.players.length < 2) {
      return;
    }
    room.roundNo += 1;
    room.phase = 'round';
    room.strokes = [];
    room.lastGuessInput = null;
    for (const p of room.players) {
      p.guessed = false;
      p.roundGained = 0;
    }
    if (room.drawRule === 'chain' && room.chain) {
      this.startChainSegment(room);
    } else {
      this.startClassicRound(room);
    }
  }

  /** classic：rotation 引擎取画者（跳过当前离线玩家），词库抽词。 */
  private startClassicRound(room: Room): void {
    room.guesserId = null;
    let drawer: RoomPlayer | undefined;
    if (room.rotation) {
      const n = room.rotation.order.length;
      for (let i = 0; i < n; i += 1) {
        const id = nextDrawer(room.rotation);
        const cand = room.players.find((p) => p.userId === id);
        if (!cand) {
          continue;
        }
        if (!drawer) {
          drawer = cand; // 全员离线时的兜底
        }
        if (cand.socketId) {
          drawer = cand;
          break;
        }
      }
    }
    if (!drawer) {
      drawer = room.players[0];
    }
    room.drawerId = drawer.userId;
    const word =
      this.words.random(room.usedWordTexts) ?? this.words.random();
    if (!word) {
      void this.endMatch(room, '词库为空');
      return;
    }
    room.word = word;
    room.usedWordTexts.add(word.text);
    room.prompt = { text: word.text, category: word.category };
    this.emitRound(room);
  }

  /** chain：按链序配对推进段；段 0 取词库词，段 k>0 承接上一段末条输入。 */
  private startChainSegment(room: Room): void {
    const chain = room.chain!;
    const roles = chainPairs(rotateChain(chain.order, chain.offset));
    const role = roles[chain.segUsed];
    if (!role) {
      void this.endMatch(room, '链段异常');
      return;
    }
    room.drawerId = role.drawerId;
    room.guesserId = role.guesserId;
    chain.segUsed += 1;
    const k = chain.globalSeg;
    chain.globalSeg += 1;
    if (k === 0) {
      const word =
        this.words.random(room.usedWordTexts) ?? this.words.random();
      if (!word) {
        void this.endMatch(room, '词库为空');
        return;
      }
      room.word = word;
      room.usedWordTexts.add(word.text);
      room.prompt = { text: word.text, category: word.category };
      chain.trail = [word.text];
    } else {
      room.word = null;
      const carried = chain.trail[chain.trail.length - 1] ?? '';
      if (!carried) {
        void this.endMatch(room, '词库为空');
        return;
      }
      room.prompt = { text: carried, category: null };
    }
    this.emitRound(room);
  }

  /** 下发 round:start（画者带题目，chain 全员带指定猜词者与链进度）。 */
  private emitRound(room: Room): void {
    room.endsAt = Date.now() + room.roundSeconds * 1000;
    for (const p of room.players) {
      if (!p.socketId) {
        continue;
      }
      const s = this.server?.sockets.get(p.socketId);
      if (s) {
        this.emitRoundStart(s, room, p.userId === room.drawerId);
      }
    }
    this.emitTimer(room);
    room.timer = setInterval(() => {
      if (room.phase !== 'round' || !room.endsAt) {
        return;
      }
      const remaining = Math.ceil((room.endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        this.endRound(room, '时间到');
        return;
      }
      this.server?.to(room.code).emit('timer', { remaining });
    }, 1000);
  }

  private emitRoundStart(socket: Socket, room: Room, isDrawer: boolean): void {
    const payload: Record<string, unknown> = {
      roundNo: room.roundNo,
      drawerId: room.drawerId,
      charCount: room.prompt ? room.prompt.text.length : 0,
      endsAt: room.endsAt,
    };
    if (isDrawer && room.prompt) {
      payload.word = room.prompt.text;
      if (room.prompt.category) {
        payload.category = room.prompt.category;
      }
    }
    if (room.drawRule === 'chain') {
      payload.guesserId = room.guesserId;
      payload.chainIndex = room.chain?.chainIndex ?? null;
      payload.chainTotal = room.chain?.chainTotal ?? null;
    }
    socket.emit('round:start', payload);
  }

  private sendRoundStartTo(socket: Socket, room: Room): void {
    const user = socket.data.user as HandshakeUser;
    this.emitRoundStart(
      socket,
      room,
      room.drawerId === user?.sub,
    );
  }

  private emitTimer(room: Room): void {
    if (!room.endsAt) {
      return;
    }
    const remaining = Math.max(
      0,
      Math.ceil((room.endsAt - Date.now()) / 1000),
    );
    this.server?.to(room.code).emit('timer', { remaining });
  }

  private endRound(room: Room, reason: string): void {
    if (room.phase !== 'round') {
      return;
    }
    room.phase = 'pause';
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    const guesserGains = room.players
      .filter((p) => p.userId !== room.drawerId && p.roundGained > 0)
      .map((p) => p.roundGained);
    const drawer = room.players.find((p) => p.userId === room.drawerId);
    const gained = drawer ? drawerScore(guesserGains) : 0;
    if (drawer) {
      drawer.roundGained = gained;
      drawer.score += gained;
    }

    // chain：段收尾 — 传题、wordTrail、段元信息、回放集（每段存入后清画板）
    let passedText: string | undefined;
    if (room.drawRule === 'chain' && room.chain && room.prompt) {
      const chain = room.chain;
      passedText = passPrompt(room.prompt.text, room.lastGuessInput);
      const meta: ChainSegmentMeta = {
        roundNo: room.roundNo,
        drawerId: room.drawerId ?? '',
        guesserId: room.guesserId ?? '',
        prompt: room.prompt.text,
        passedText,
      };
      chain.segments.push(meta);
      chain.history.push(meta);
      chain.replay.push({
        roundNo: room.roundNo,
        strokes: [...room.strokes],
        prompt: room.prompt.text,
      });
      chain.trail = appendWordTrail(chain.trail, passedText);
    }

    this.server?.to(room.code).emit('round:end', {
      roundNo: room.roundNo,
      word: room.prompt?.text ?? null,
      reason,
      scores: room.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        gained: p.roundGained,
        total: p.score,
      })),
      ...(room.chain && passedText !== undefined
        ? { passedText, wordTrail: [...room.chain.trail] }
        : {}),
    });
    if (room.prompt) {
      this.systemChat(room.code, `本回合答案：${room.prompt.text}`);
    }
    room.endsAt = null;
    room.word = null;
    room.prompt = null;
    room.drawerId = null;
    room.guesserId = null;
    room.pauseTimer = setTimeout(() => this.afterRoundPause(room), ROUND_PAUSE_MS);
  }

  private afterRoundPause(room: Room): void {
    room.pauseTimer = null;
    if (room.status !== 'playing') {
      return;
    }
    if (room.players.length < 2) {
      void this.endMatch(room, '人数不足，对局提前结束');
      return;
    }
    const total = room.totalRounds ?? 0;
    if (room.drawRule === 'chain' && room.chain) {
      const chain = room.chain;
      if (chain.segUsed < chain.segTotal && room.roundNo < total) {
        this.startRound(room);
      } else {
        this.finishChain(room);
      }
      return;
    }
    if (room.roundNo >= total) {
      void this.endMatch(room, '全部回合结束');
    } else {
      this.startRound(room);
    }
  }

  /** 一条链完成 → chain:end（段元信息 + 词语演化链 + 按段回放）→ 投票阶段。 */
  private finishChain(room: Room): void {
    const chain = room.chain;
    if (!chain) {
      void this.endMatch(room, '全部回合结束');
      return;
    }
    room.phase = 'vote';
    chain.votes = new Map();
    this.server?.to(room.code).emit('chain:end', {
      segments: chain.segments,
      wordTrail: [...chain.trail],
      replay: chain.replay,
    });
    room.voteTimer = setTimeout(() => {
      room.voteTimer = null;
      this.finalizeVote(room);
    }, VOTE_TIMEOUT_MS);
  }

  /** 全员投票（或 30s 超时）→ vote:result → 下一条链（offset+1）或整场结算。 */
  private finalizeVote(room: Room): void {
    if (room.phase !== 'vote' || !room.chain) {
      return;
    }
    const chain = room.chain;
    if (room.voteTimer) {
      clearTimeout(room.voteTimer);
      room.voteTimer = null;
    }
    const counts: Record<string, number> = { 1: 0, 2: 0, 3: 0 };
    for (const c of chain.votes.values()) {
      counts[String(c)] += 1;
    }
    chain.votes = new Map();
    this.server?.to(room.code).emit('vote:result', {
      counts,
      wordTrail: [...chain.trail],
    });
    room.phase = 'pause';
    room.pauseTimer = setTimeout(() => {
      room.pauseTimer = null;
      if (room.status !== 'playing') {
        return;
      }
      if (room.players.length < 2) {
        void this.endMatch(room, '人数不足，对局提前结束');
        return;
      }
      const total = room.totalRounds ?? 0;
      if (room.roundNo >= total) {
        void this.endMatch(room, '全部回合结束');
        return;
      }
      this.startNextChain(room);
    }, ROUND_PAUSE_MS);
  }

  private startNextChain(room: Room): void {
    const chain = room.chain;
    if (!chain) {
      void this.endMatch(room, '全部回合结束');
      return;
    }
    chain.offset += 1;
    chain.chainIndex += 1;
    chain.segTotal = Math.min(
      chain.fullLen,
      (room.totalRounds ?? 0) - room.roundNo,
    );
    chain.segUsed = 0;
    chain.segments = [];
    chain.replay = [];
    this.startRound(room);
  }

  private async endMatch(room: Room, reason: string): Promise<void> {
    if (room.status !== 'playing') {
      return;
    }
    room.status = 'finished';
    room.phase = null;
    room.endsAt = null;
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    if (room.pauseTimer) {
      clearTimeout(room.pauseTimer);
      room.pauseTimer = null;
    }
    if (room.voteTimer) {
      clearTimeout(room.voteTimer);
      room.voteTimer = null;
    }
    const ranks = computeRanks(
      room.players.map((p) => ({ userId: p.userId, score: p.score })),
    );
    const results = [...room.players]
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        avatarId: p.avatarId,
        score: p.score,
        rank: ranks.get(p.userId) ?? 0,
      }));
    this.server?.to(room.code).emit('game:end', { results, reason });
    this.systemChat(room.code, `对局结束（${reason}），总分排名已生成`);
    try {
      await this.matches.save({
        roomCode: room.code,
        rounds: room.totalRounds ?? room.roundNo,
        endedAt: new Date(),
        players: results.map((r) => ({
          userId: r.userId,
          username: r.username,
          score: r.score,
          rank: r.rank,
        })),
      });
    } catch (e) {
      this.logger.error('对局落库失败', e as Error);
    }
  }

  // ---------- 画板 / 聊天 / 猜词 / 投票 ----------

  handleStroke(socket: Socket, body: unknown): void {
    const room = this.roomOf(socket);
    if (!room) {
      return;
    }
    if (room.status !== 'playing' || room.phase !== 'round') {
      return this.err(socket, '对局未开始，无法绘画');
    }
    const user = socket.data.user as HandshakeUser;
    if (room.drawerId !== user.sub) {
      return this.err(socket, '只有当前画者可以绘画');
    }
    const stroke = sanitizeStroke(body);
    if (!stroke) {
      return this.err(socket, '非法笔迹数据');
    }
    room.strokes.push(stroke);
    socket.to(room.code).emit('stroke', stroke);
  }

  handleClear(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room) {
      return;
    }
    const user = socket.data.user as HandshakeUser;
    if (room.status !== 'playing' || room.drawerId !== user.sub) {
      return this.err(socket, '只有当前画者可以清空画布');
    }
    room.strokes = [];
    this.server?.to(room.code).emit('tool:cleared', {
      by: user.sub,
    });
  }

  handleGuess(socket: Socket, body: unknown): void {
    const room = this.roomOf(socket);
    if (!room) {
      return;
    }
    const user = socket.data.user as HandshakeUser;
    if (room.status !== 'playing') {
      return this.err(socket, '对局尚未开始');
    }
    if (room.phase !== 'round' || !room.endsAt || !room.prompt) {
      return this.err(socket, '当前不在猜词阶段');
    }
    const player = room.players.find((p) => p.userId === user.sub);
    if (!player) {
      return this.err(socket, '请先加入房间');
    }

    if (room.drawRule === 'chain') {
      const reject = guessRejection(room.guesserId, user.sub);
      if (reject) {
        return this.err(socket, reject);
      }
      // 指定猜词者单次提交：无论是否猜中，末条输入一律传给下一棒作画
      const text = extractText(body);
      const correct =
        !!text &&
        normalizeGuessText(text) === normalizeGuessText(room.prompt.text);
      if (correct) {
        const remaining = Math.max(0, (room.endsAt - Date.now()) / 1000);
        const gained = guesserScore(remaining, room.roundSeconds);
        player.guessed = true;
        player.roundGained = gained;
        player.score += gained;
        this.server?.to(room.code).emit('guess:correct', {
          playerId: player.userId,
          gained,
        });
        this.systemChat(room.code, `${player.username} 猜对了！+${gained} 分`);
      }
      room.lastGuessInput = text;
      this.endRound(
        room,
        correct ? '指定玩家猜中' : text ? '未猜中' : '未提交',
      );
      return;
    }

    // classic（行为不变）
    if (room.drawerId === user.sub) {
      return this.err(socket, '画者不能猜词');
    }
    if (player.guessed) {
      return this.err(socket, '本轮你已猜中，可继续聊天');
    }
    const text = extractText(body);
    if (!text) {
      return this.err(socket, '请输入猜测内容');
    }
    if (
      normalizeGuessText(text) !== normalizeGuessText(room.prompt.text)
    ) {
      socket.emit('chat', {
        playerId: null,
        username: '系统',
        text: '猜错了，再试试~',
        at: Date.now(),
      });
      return;
    }
    const remaining = Math.max(0, (room.endsAt - Date.now()) / 1000);
    const gained = guesserScore(remaining, room.roundSeconds);
    player.guessed = true;
    player.roundGained = gained;
    player.score += gained;
    this.server?.to(room.code).emit('guess:correct', {
      playerId: player.userId,
      gained,
    });
    this.systemChat(
      room.code,
      `${player.username} 猜对了！+${gained} 分`,
    );
    if (this.allGuessed(room)) {
      this.endRound(room, '全员猜中');
    }
  }

  /** 投票：chain 链完成阶段，每人一次（重复忽略），全员完成或 30s 超时聚合。 */
  handleVote(socket: Socket, body: unknown): void {
    const room = this.roomOf(socket);
    if (!room) {
      return;
    }
    const user = socket.data.user as HandshakeUser;
    if (
      room.status !== 'playing' ||
      room.phase !== 'vote' ||
      !room.chain
    ) {
      return this.err(socket, '当前不在投票阶段');
    }
    if (!room.players.some((p) => p.userId === user.sub)) {
      return this.err(socket, '请先加入房间');
    }
    const choice = extractChoice(body);
    if (!choice) {
      return this.err(socket, '非法投票选项（choice 取 1|2|3）');
    }
    if (room.chain.votes.has(user.sub)) {
      return; // 每人一次，重复忽略
    }
    room.chain.votes.set(user.sub, choice);
    if (room.chain.votes.size >= room.players.length) {
      this.finalizeVote(room);
    }
  }

  handleChat(socket: Socket, body: unknown): void {
    const room = this.roomOf(socket);
    if (!room) {
      return;
    }
    const user = socket.data.user as HandshakeUser;
    const text = extractText(body);
    if (!text) {
      return this.err(socket, '消息不能为空');
    }
    if (text.length > 200) {
      return this.err(socket, '消息过长（最多 200 字）');
    }
    this.server?.to(room.code).emit('chat', {
      playerId: user.sub,
      username: user.username,
      text,
      at: Date.now(),
    });
  }

  // ---------- 工具 ----------

  private roomOf(socket: Socket): Room | null {
    const user = socket.data.user as HandshakeUser | undefined;
    if (!user) {
      this.err(socket, '未授权');
      return null;
    }
    const code = socket.data.roomCode as string | undefined;
    if (!code) {
      this.err(socket, '请先加入房间');
      return null;
    }
    const room = this.registry.get(code);
    if (!room) {
      this.err(socket, '房间不存在');
      return null;
    }
    return room;
  }

  private allGuessed(room: Room): boolean {
    const nonDrawers = room.players.filter(
      (p) => p.userId !== room.drawerId,
    );
    return nonDrawers.length > 0 && nonDrawers.every((p) => p.guessed);
  }

  private systemChat(code: string, text: string): void {
    this.server?.to(code).emit('chat', {
      playerId: null,
      username: '系统',
      text,
      at: Date.now(),
    });
  }

  private err(socket: Socket, message: string): void {
    socket.emit('error', { message });
  }
}

function publicPlayer(p: RoomPlayer) {
  return {
    userId: p.userId,
    username: p.username,
    avatarId: p.avatarId,
    publicId: p.publicId,
    score: p.score,
    guessed: p.guessed,
  };
}

function extractCode(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body && typeof body === 'object' && 'code' in body) {
    return String((body as { code: unknown }).code ?? '');
  }
  return '';
}

function extractText(body: unknown): string {
  if (typeof body === 'string') {
    return body.trim();
  }
  if (body && typeof body === 'object' && 'text' in body) {
    return String((body as { text: unknown }).text ?? '').trim();
  }
  return '';
}

function extractChoice(body: unknown): 1 | 2 | 3 | null {
  const raw =
    typeof body === 'object' && body !== null && 'choice' in body
      ? (body as { choice: unknown }).choice
      : body;
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

/** 宽松清洗：坐标夹紧到 [0,1]，颜色/线宽兜底。 */
function sanitizeStroke(body: unknown): Stroke | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const b = body as Record<string, unknown>;
  const x = Number(b.x);
  const y = Number(b.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const width = Number(b.width);
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    color: typeof b.color === 'string' && b.color.length <= 64 ? b.color : '#2E2645',
    width: Number.isFinite(width) ? Math.min(64, Math.max(0, width)) : 4,
    down: b.down === true,
  };
}
