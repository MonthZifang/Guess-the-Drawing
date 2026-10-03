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
  /** 画板规则（room:state / 快照下发） */
  drawRule?: 'classic' | 'chain';
  /** 链式：本段作画题目（含上一棒传题） */
  prompt?: string;
  /** 链式：题目的词库类别（仅词库原词段有） */
  promptCategory?: string;
  /** 链式：本段指定猜词者 */
  guesserId?: string;
  /** 链式：当前链序号（1 起，非段序）与链总数 */
  chainIndex?: number;
  chainTotal?: number;
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
  /** 链式：本段指定猜词者（round:start 下发） */
  guesserId?: string;
  /** 链式：当前链序号（1 起，非段序）与链总数 */
  chainIndex?: number;
  chainTotal?: number;
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
    drawRule: o.drawRule === 'chain' || o.drawRule === 'classic' ? o.drawRule : undefined,
    prompt: typeof o.prompt === 'string' && o.prompt ? o.prompt : undefined,
    promptCategory: typeof o.promptCategory === 'string' && o.promptCategory ? o.promptCategory : undefined,
    guesserId: idOf(o.guesserId) ?? idOf(root.guesserId) ?? undefined,
    chainIndex: Number.isFinite(Number(o.chainIndex)) && o.chainIndex != null ? Number(o.chainIndex) : undefined,
    chainTotal: Number.isFinite(Number(o.chainTotal)) && o.chainTotal != null ? Number(o.chainTotal) : undefined,
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
    guesserId: idOf(o.guesserId) ?? undefined,
    chainIndex:
      o.chainIndex != null && Number.isFinite(Number(o.chainIndex))
        ? Number(o.chainIndex)
        : undefined,
    chainTotal:
      o.chainTotal != null && Number.isFinite(Number(o.chainTotal))
        ? Number(o.chainTotal)
        : undefined,
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

/* ---------- 链式画猜 ---------- */

/** 词语演化链：数组原样；字符串按 → / -> / > 切分 */
export function normalizeWordTrail(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/(?:→|->|>)/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export interface ChainSegment {
  drawerId: string;
  guesserId: string;
  prompt: string;
  passedText?: string;
}

export interface ChainReplaySeg {
  roundNo: number;
  strokes: StrokeEvent[];
  prompt: string;
}

export interface ChainEndData {
  segments: ChainSegment[];
  replay: ChainReplaySeg[];
  wordTrail: string[];
  /** 本链最后一段的回合号（用于识别下一条链的 room:state） */
  roundNo: number;
}

/** chain:end { segments, wordTrail, replay } */
export function normalizeChainEnd(raw: unknown): ChainEndData {
  const o = asObj(raw);
  const replay: ChainReplaySeg[] = (Array.isArray(o.replay) ? o.replay : []).map((r) => {
    const seg = asObj(r);
    const strokes = Array.isArray(seg.strokes)
      ? seg.strokes.map(normalizeStroke).filter((s): s is StrokeEvent => s !== null)
      : [];
    return {
      roundNo: Number(seg.roundNo) || 0,
      strokes,
      prompt: typeof seg.prompt === 'string' ? seg.prompt : '',
    };
  });
  const segments: ChainSegment[] = (Array.isArray(o.segments) ? o.segments : []).map((s) => {
    const seg = asObj(s);
    return {
      drawerId: idOf(seg.drawerId) ?? idOf(seg.drawer) ?? '',
      guesserId: idOf(seg.guesserId) ?? idOf(seg.guesser) ?? '',
      prompt: typeof seg.prompt === 'string' ? seg.prompt : '',
      passedText: typeof seg.passedText === 'string' && seg.passedText ? seg.passedText : undefined,
    };
  });
  const roundNos = replay.map((r) => r.roundNo).filter((n) => n > 0);
  const roundNo = roundNos.length > 0 ? Math.max(...roundNos) : 0;
  return { segments, replay, wordTrail: normalizeWordTrail(o.wordTrail), roundNo };
}

/** vote:result { counts } → [完全一样, 有点跑偏, 面目全非] */
export function normalizeVoteCounts(raw: unknown): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const setAt = (idx: number, n: unknown) => {
    const v = Number(n);
    if (idx >= 1 && idx <= 3 && Number.isFinite(v)) out[idx - 1] = v;
  };
  if (Array.isArray(raw)) {
    if (raw.some((x) => x && typeof x === 'object')) {
      raw.forEach((x) => {
        const o = asObj(x);
        setAt(Number(o.choice ?? o.value ?? o.key), o.count ?? o.votes ?? o.n);
      });
    } else {
      raw.forEach((x, i) => setAt(i + 1, x));
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const digits = String(k).match(/\d+/);
      if (digits) setAt(Number(digits[0]), v);
    }
  }
  return out;
}
