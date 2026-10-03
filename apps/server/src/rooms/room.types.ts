import type { WordRecord } from '../storage/stores';
import type { OrderRule, RotationState, RoundsSpec } from '../game/rotation';

export type RoomStatus = 'waiting' | 'playing' | 'finished';
export type DrawRule = 'classic' | 'chain';

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
  /** 排序键 publicId（数字，缺省回退 userId），SSO 用户资料而来 */
  publicId: number | null;
  socketId: string | null;
  joinedAt: number;
  /** 本场总分 */
  score: number;
  /** 本轮是否已猜中 */
  guessed: boolean;
  /** 本轮获得分（画者为回合结束时结算的抽成分） */
  roundGained: number;
}

/** 链式：当前链一个段的元信息（chain:end 下发） */
export interface ChainSegmentMeta {
  roundNo: number;
  drawerId: string;
  guesserId: string;
  prompt: string;
  /** 传给下一段的文本（末条提交，规范化+12 字截断；空则续传原题） */
  passedText: string;
}

/** 链式：一段的回放数据（chain:end 下发） */
export interface ChainReplayEntry {
  roundNo: number;
  strokes: Stroke[];
  prompt: string;
}

/** 链式房间态 */
export interface ChainState {
  /** 开局生成的链序（此后不换序） */
  order: string[];
  /** 当前链轮转位（第一条链 0，之后 +1） */
  offset: number;
  /** 当前链序号（1 起） */
  chainIndex: number;
  /** 总链数 = ceil(totalRounds / 单链段数) */
  chainTotal: number;
  /** 单链段数 = ceil(N/2) */
  fullLen: number;
  /** 当前链段数 = min(单链段数, 剩余回合) */
  segTotal: number;
  /** 当前链已用段 */
  segUsed: number;
  /** 当前链已完成段（chain:end 下发 segments） */
  segments: ChainSegmentMeta[];
  /** 当前链回放集（每段存入后清画板） */
  replay: ChainReplayEntry[];
  /** 全场词语演化链（词库词 → … → 最终词） */
  trail: string[];
  /** 投票集：userId → choice(1|2|3)，每人一次 */
  votes: Map<string, 1 | 2 | 3>;
  /** 全场已开始的段序 k（段 0 取词库词，段 k>0 承接上一段末条输入） */
  globalSeg: number;
}

export interface Room {
  code: string;
  ownerId: string;
  maxPlayers: number;
  /** 画者顺序规则 */
  orderRule: OrderRule;
  /** 画板规则 */
  drawRule: DrawRule;
  /** 回合计法（byPlayers 在 game:start 时按人数解析） */
  roundsSpec: RoundsSpec;
  /** 解析后的总回合（开局前 byPlayers 为 null） */
  totalRounds: number | null;
  roundSeconds: number;
  status: RoomStatus;
  /** 对局阶段：round=绘画猜词中，pause=回合间暂停，vote=链完成投票中 */
  phase: 'round' | 'pause' | 'vote' | null;
  /** 按加入顺序 */
  players: RoomPlayer[];
  roundNo: number;
  /** 本回合已产生的笔迹（新回合清空；chain 每段存入 replay 后清） */
  strokes: Stroke[];
  drawerId: string | null;
  /** chain 模式：本段指定猜词者 */
  guesserId: string | null;
  word: WordRecord | null;
  /** 本回合题目（classic=词库词；chain 段 k>0 为传导文本） */
  prompt: { text: string; category: string | null } | null;
  /** chain：猜词者末条提交（传导用） */
  lastGuessInput: string | null;
  /** 回合结束时间戳（ms） */
  endsAt: number | null;
  /** 本场已用过的词（避免重复） */
  usedWordTexts: Set<string>;
  /** 经典/链式圈内轮换引擎 */
  rotation: RotationState | null;
  /** 链式态 */
  chain: ChainState | null;
  /** 每秒 timer 广播句柄 */
  timer: ReturnType<typeof setInterval> | null;
  /** 回合间暂停句柄 */
  pauseTimer: ReturnType<typeof setTimeout> | null;
  /** 投票超时句柄（回放估时 + VOTE_TIMEOUT_MS） */
  voteTimer: ReturnType<typeof setTimeout> | null;
}

export const MAX_PLAYERS = 60;
export const DEFAULT_ROUNDS = 6;
export const ROUND_SECONDS = 80;
/** 回合结束 → 下一回合开始的暂停时长（规格未定，取 5 秒） */
export const ROUND_PAUSE_MS = 5000;
/** 链完成投票超时（规格：回放播完后再 30 秒） */
export const VOTE_TIMEOUT_MS = 30000;
/** 单段回放时长估计——必须与前端 ChainStage.SEG_DURATION 保持一致 */
export const SEGMENT_REPLAY_MS = 2500;
/** 邀请码：6 位，32 字字符集（去易混 I/O/0/1） */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
