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
  Room,
  RoomPlayer,
  ROUND_PAUSE_MS,
  Stroke,
} from '../rooms/room.types';
import { roomSnapshot } from '../rooms/rooms.controller';
import {
  computeRanks,
  drawerScore,
  guesserScore,
  normalizeGuessText,
} from './scoring';

interface HandshakeUser {
  sub: string;
  username: string;
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
      }
    } else {
      if (room.players.length >= room.maxPlayers) {
        return this.err(socket, '房间已满（最多 8 人）');
      }
      player = {
        userId: user.sub,
        username: profile?.username ?? user.username,
        avatarId: profile?.avatarId ?? 1,
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
    this.server?.to(room.code).emit('game:started', {
      rounds: room.rounds,
      roundSeconds: room.roundSeconds,
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
    for (const p of room.players) {
      p.guessed = false;
      p.roundGained = 0;
    }
    const drawer =
      room.players[(room.roundNo - 1) % room.players.length];
    room.drawerId = drawer.userId;
    const word =
      this.words.random(room.usedWordTexts) ?? this.words.random();
    if (!word) {
      void this.endMatch(room, '词库为空');
      return;
    }
    room.word = word;
    room.usedWordTexts.add(word.text);
    room.endsAt = Date.now() + room.roundSeconds * 1000;

    for (const p of room.players) {
      if (!p.socketId) {
        continue;
      }
      const s = this.server?.sockets.get(p.socketId);
      if (s) {
        this.emitRoundStart(s, room, p.userId === drawer.userId);
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
    socket.emit('round:start', {
      roundNo: room.roundNo,
      drawerId: room.drawerId,
      ...(isDrawer && room.word ? { word: room.word.text } : {}),
      charCount: room.word ? room.word.text.length : 0,
      endsAt: room.endsAt,
    });
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
    this.server?.to(room.code).emit('round:end', {
      roundNo: room.roundNo,
      word: room.word?.text ?? null,
      reason,
      scores: room.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        gained: p.roundGained,
        total: p.score,
      })),
    });
    if (room.word) {
      this.systemChat(room.code, `本回合答案：${room.word.text}`);
    }
    room.endsAt = null;
    room.word = null;
    room.drawerId = null;
    room.pauseTimer = setTimeout(() => {
      room.pauseTimer = null;
      if (room.status !== 'playing') {
        return;
      }
      if (room.players.length < 2) {
        void this.endMatch(room, '人数不足，对局提前结束');
        return;
      }
      if (room.roundNo >= room.rounds) {
        void this.endMatch(room, '全部回合结束');
      } else {
        this.startRound(room);
      }
    }, ROUND_PAUSE_MS);
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
        rounds: room.rounds,
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

  // ---------- 画板 / 聊天 / 猜词 ----------

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
    if (room.phase !== 'round' || !room.endsAt || !room.word) {
      return this.err(socket, '当前不在猜词阶段');
    }
    if (room.drawerId === user.sub) {
      return this.err(socket, '画者不能猜词');
    }
    const player = room.players.find((p) => p.userId === user.sub);
    if (!player) {
      return this.err(socket, '请先加入房间');
    }
    if (player.guessed) {
      return this.err(socket, '本轮你已猜中，可继续聊天');
    }
    const text = extractText(body);
    if (!text) {
      return this.err(socket, '请输入猜测内容');
    }
    if (normalizeGuessText(text) !== normalizeGuessText(room.word.text)) {
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
