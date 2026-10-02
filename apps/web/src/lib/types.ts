/** 与后端契约对齐的共享类型 + 宽松的载荷归一化（后端字段做防御性兼容） */

export interface User {
  id: string;
  username: string;
  avatarId?: number | string;
}

export interface RoomPlayer {
  id: string;
  username: string;
  avatarId?: number | string;
  score: number;
  /** 本回合是否已猜中（后端 publicPlayer.guessed） */
  guessed?: boolean;
}

export interface RoomState {
  code?: string;
  hostId?: string;
  players: RoomPlayer[];
  status?: string;
  roundNo?: number;
  totalRounds?: number;
  /** 本回合已产生的笔迹（随快照下发，用于中途加入/刷新回放） */
  strokes: StrokeEvent[];
  drawerId?: string;
  /** 仅画者可见 */
  word?: string;
  /** 仅画者可见（词的类别） */
  category?: string;
  charCount?: number;
  endsAt?: number;
}

export interface StrokeEvent {
  x: number;
  y: number;
  color: string;
  width: number;
  down: boolean;
}

export interface RoundInfo {
  roundNo: number;
  drawerId: string;
  word?: string;
  charCount: number;
  endsAt?: number;
  category?: string;
}

export interface RoundScore {
  playerId: string;
  gained: number;
  username?: string;
  total?: number;
}

export interface ResultRow {
  playerId?: string;
  username: string;
  avatarId?: number | string;
  score: number;
  rank: number;
}

export interface ChatMsg {
  id: number;
  kind: 'system' | 'player';
  playerId?: string;
  username?: string;
  text: string;
}

type Any = Record<string, any>;

let seq = 0;
export const nextMsgId = () => ++seq;

function asObj(raw: unknown): Any {
  return raw && typeof raw === 'object' ? (raw as Any) : {};
}

function idOf(v: unknown): string | undefined {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object') {
    const o = v as Any;
    if (typeof o.id === 'string') return o.id;
    if (typeof o.userId === 'string') return o.userId;
  }
  return undefined;
}

function toEpochMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  }
  return undefined;
}

export function normalizePlayers(raw: unknown): RoomPlayer[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p, i) => {
    const o = asObj(p);
    return {
      id: idOf(o) ?? idOf(o.player) ?? `p${i}`,
      username: String(o.username ?? o.name ?? o.player?.username ?? `玩家${i + 1}`),
      avatarId: o.avatarId ?? o.avatar ?? o.player?.avatarId,
      score: Number(o.score ?? o.points ?? o.total ?? 0) || 0,
      guessed: o.guessed === true,
    };
  });
}

export function normalizeRoomState(raw: unknown): RoomState {
  const root = asObj(raw);
  const o = asObj(root.room ?? root.state ?? root);
  const strokesRaw = o.strokes ?? root.strokes;
  const strokes: StrokeEvent[] = Array.isArray(strokesRaw)
    ? strokesRaw
        .map((s) => normalizeStroke(s))
        .filter((s): s is StrokeEvent => s !== null)
    : [];
  const charCountRaw = o.charCount ?? root.charCount;
  const endsAt = toEpochMs(o.endsAt ?? root.endsAt);
  return {
    code: typeof o.code === 'string' ? o.code : undefined,
    hostId: idOf(o.ownerId) ?? idOf(o.hostId) ?? idOf(o.owner) ?? idOf(root.ownerId) ?? idOf(root.hostId),
    players: normalizePlayers(o.players ?? root.players),
    status: typeof o.status === 'string' ? o.status : typeof o.phase === 'string' ? o.phase : undefined,
    roundNo: Number(o.roundNo ?? o.round ?? root.roundNo) || undefined,
    totalRounds: Number(o.totalRounds ?? o.rounds ?? root.totalRounds) || undefined,
    strokes,
    drawerId: idOf(o.drawerId) ?? idOf(root.drawerId) ?? undefined,
    word: typeof o.word === 'string' && o.word ? o.word : undefined,
    category: typeof o.category === 'string' && o.category ? o.category : undefined,
    charCount: typeof charCountRaw === 'number' && Number.isFinite(charCountRaw) ? charCountRaw : undefined,
    endsAt: endsAt ?? undefined,
  };
}

export function normalizeRoundStart(raw: unknown): RoundInfo {
  const o = asObj(raw);
  const word = typeof o.word === 'string' && o.word ? o.word : undefined;
  const charCount = Number.isFinite(Number(o.charCount))
    ? Number(o.charCount)
    : word
      ? word.length
      : 0;
  return {
    roundNo: Number(o.roundNo ?? o.round ?? 0) || 0,
    drawerId: idOf(o.drawerId) ?? idOf(o.drawer) ?? '',
    word,
    charCount,
    endsAt: toEpochMs(o.endsAt ?? o.deadline ?? o.endTime),
    category: typeof o.category === 'string' ? o.category : undefined,
  };
}

export function normalizeStroke(raw: unknown): StrokeEvent | null {
  const o = asObj(raw);
  const x = Number(o.x);
  const y = Number(o.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    color: typeof o.color === 'string' ? o.color : '#2e2645',
    width: Number.isFinite(Number(o.width)) ? Number(o.width) : 6,
    down: o.down === true || o.down === 1 || o.down === 'true',
  };
}

export function normalizeScores(raw: unknown): RoundScore[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => {
      const o = asObj(s);
      return {
        playerId: idOf(o) ?? idOf(o.player) ?? '',
        gained: Number(o.gained ?? o.score ?? o.points ?? 0) || 0,
        username: typeof o.username === 'string' ? o.username : undefined,
        total: Number.isFinite(Number(o.total)) ? Number(o.total) : undefined,
      };
    });
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([playerId, gained]) => ({
      playerId,
      gained: Number(gained) || 0,
    }));
  }
  return [];
}

export function normalizeResults(raw: unknown): ResultRow[] {
  const root = asObj(raw);
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(root.results)
      ? root.results
      : Array.isArray(root.players)
        ? root.players
        : Array.isArray(root.rankings)
          ? root.rankings
          : [];
  const rows: ResultRow[] = arr.map((p, i) => {
    const o = asObj(p);
    return {
      playerId: idOf(o),
      username: String(o.username ?? o.name ?? `玩家${i + 1}`),
      avatarId: o.avatarId ?? o.avatar,
      score: Number(o.score ?? o.totalScore ?? o.total ?? o.points ?? 0) || 0,
      rank: Number(o.rank ?? o.position ?? 0) || 0,
    };
  });
  rows.sort((a, b) => (a.rank && b.rank ? a.rank - b.rank : b.score - a.score));
  rows.forEach((r, i) => {
    if (!r.rank) r.rank = i + 1;
  });
  return rows;
}

export function normalizeTimer(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  const o = asObj(raw);
  const v = o.remaining ?? o.seconds ?? o.left ?? o.remain;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  return null;
}

export function normalizeChat(raw: unknown): ChatMsg | null {
  if (typeof raw === 'string') {
    return raw ? { id: nextMsgId(), kind: 'system', text: raw } : null;
  }
  const o = asObj(raw);
  const text = String(o.text ?? o.message ?? o.content ?? '').trim();
  if (!text) return null;
  const playerId = idOf(o.playerId) ?? idOf(o.userId) ?? idOf(o.player);
  const username = typeof o.username === 'string' ? o.username : typeof o.name === 'string' ? o.name : undefined;
  // 后端系统行：playerId 字段存在且为 null
  const system =
    ('playerId' in o && o.playerId == null) ||
    o.system === true ||
    o.type === 'system' ||
    o.kind === 'system' ||
    (!playerId && !username);
  return {
    id: nextMsgId(),
    kind: system ? 'system' : 'player',
    playerId,
    username,
    text,
  };
}

export function errorMessage(raw: unknown): string {
  if (typeof raw === 'string' && raw) return raw;
  const o = asObj(raw);
  const m = o.message ?? o.error;
  if (Array.isArray(m)) return m.join(' ');
  if (typeof m === 'string' && m) return m;
  return '发生未知错误';
}
