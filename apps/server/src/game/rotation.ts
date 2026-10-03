/**
 * 画者顺序规则 / 链序生成（纯函数，可单测）：
 * - id          顺序：按 (publicId ?? userId) 升序，每圈沿用同一顺序
 * - lapShuffle  随机：每圈开始 Fisher-Yates 洗牌，圈内不重复
 * - roundShuffle 混乱：每回合对本圈未画过的玩家重洗取队首；取空进入下一圈整圈重洗
 * 链式链序在开局生成一次；多链时 offset+1 整体轮转一位。
 */

export type OrderRule = 'id' | 'lapShuffle' | 'roundShuffle';
export type Rng = () => number;

export interface RotationPlayer {
  userId: string;
  /** 排序键：publicId（数字）优先，缺省回退 userId 字符串。 */
  publicId?: number | null;
}

export interface RoundsSpec {
  mode: 'byPlayers' | 'fixed' | 'custom';
  value?: number;
}

export interface RotationState {
  rule: OrderRule;
  /** 当前圈顺序 */
  order: string[];
  /** id / lapShuffle 的圈内游标 */
  cursor: number;
  /** roundShuffle：本圈已画过的玩家 */
  drawn: string[];
}

export const DEFAULT_ROUNDS = 6;

/** 排序键比较：数字 publicId 在前升序，其后为缺省键字符串升序。 */
function sortKey(p: RotationPlayer): { num: number | null; str: string } {
  return p.publicId != null
    ? { num: p.publicId, str: '' }
    : { num: null, str: p.userId };
}

export function sortBySortKey(players: readonly RotationPlayer[]): string[] {
  return [...players]
    .sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka.num != null && kb.num != null) return ka.num - kb.num;
      if (ka.num != null) return -1;
      if (kb.num != null) return 1;
      return ka.str < kb.str ? -1 : ka.str > kb.str ? 1 : 0;
    })
    .map((p) => p.userId);
}

/** Fisher-Yates 洗牌（返回新数组，rng 可注入以便确定性测试）。 */
export function shuffle<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 经典模式圈内轮换引擎。 */
export function createRotation(
  players: readonly RotationPlayer[],
  rule: OrderRule,
  rng: Rng = Math.random,
): RotationState {
  const sorted = sortBySortKey(players);
  const initial = rule === 'id' ? sorted : shuffle(sorted, rng);
  return { rule, order: initial, cursor: 0, drawn: [] };
}

/** 取下一回合画者并推进状态（保证同一作画圈内不重复）。 */
export function nextDrawer(state: RotationState, rng: Rng = Math.random): string {
  if (state.order.length === 0) {
    throw new Error('rotation: empty order');
  }
  if (state.rule === 'roundShuffle') {
    let pool = state.order.filter((id) => !state.drawn.includes(id));
    if (pool.length === 0) {
      // 取空 → 圈结束，整圈重洗
      state.order = shuffle(state.order, rng);
      state.drawn = [];
      pool = [...state.order];
    }
    pool = shuffle(pool, rng);
    const pick = pool[0];
    state.drawn.push(pick);
    return pick;
  }
  if (state.cursor >= state.order.length) {
    state.cursor = 0;
    if (state.rule === 'lapShuffle') {
      state.order = shuffle(state.order, rng);
    }
  }
  const pick = state.order[state.cursor];
  state.cursor += 1;
  return pick;
}

/** 回合计法解析：byPlayers → 开局时人数；fixed/custom → value（fixed 缺省 6）。 */
export function resolveRounds(spec: RoundsSpec, playerCount: number): number {
  if (spec.mode === 'byPlayers') return playerCount;
  if (spec.mode === 'custom') {
    if (spec.value == null) throw new Error('custom 模式必须指定回合数');
    return spec.value;
  }
  return spec.value ?? DEFAULT_ROUNDS;
}

/** 链式链序：开局生成一次（id=升序；两种洗牌规则各洗一次），此后不换序。 */
export function buildChainOrder(
  players: readonly RotationPlayer[],
  rule: OrderRule,
  rng: Rng = Math.random,
): string[] {
  const sorted = sortBySortKey(players);
  return rule === 'id' ? sorted : shuffle(sorted, rng);
}

/** offset+1 换链：链序整体左旋 offset 位，保证下一条链由另一半玩家作画。 */
export function rotateChain(
  order: readonly string[],
  offset: number,
): string[] {
  if (order.length === 0) return [];
  const k = ((offset % order.length) + order.length) % order.length;
  return [...order.slice(k), ...order.slice(0, k)];
}
