import type { WordRecord } from '../storage/stores';

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface Stroke {
  x: number;
  y: number;
  color: string;
  width: number;
  down: boolean;
}

export interface RoomPlayer {
  userId: string;
  username: string;
  avatarId: number;
  socketId: string | null;
  joinedAt: number;
  /** 本场总分 */
  score: number;
  /** 本轮是否已猜中 */
  guessed: boolean;
  /** 本轮获得分（画者为回合结束时结算的抽成分） */
  roundGained: number;
}

export interface Room {
  code: string;
  ownerId: string;
  maxPlayers: number;
  rounds: number;
  roundSeconds: number;
  status: RoomStatus;
  /** 对局中的回合阶段：round=绘画猜词中，pause=回合间暂停 */
  phase: 'round' | 'pause' | null;
  /** 按加入顺序 */
  players: RoomPlayer[];
  roundNo: number;
  /** 本回合已产生的笔迹（新回合清空） */
  strokes: Stroke[];
  drawerId: string | null;
  word: WordRecord | null;
  /** 回合结束时间戳（ms） */
  endsAt: number | null;
  /** 本场已用过的词（避免重复） */
  usedWordTexts: Set<string>;
  /** 每秒 timer 广播句柄 */
  timer: ReturnType<typeof setInterval> | null;
  /** 回合间暂停句柄 */
  pauseTimer: ReturnType<typeof setTimeout> | null;
}

export const MAX_PLAYERS = 8;
export const DEFAULT_ROUNDS = 6;
export const ROUND_SECONDS = 80;
/** 回合结束 → 下一回合开始的暂停时长（规格未定，取 5 秒） */
export const ROUND_PAUSE_MS = 5000;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
