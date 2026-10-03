import {
  buildChainOrder,
  createRotation,
  nextDrawer,
  resolveRounds,
  rotateChain,
  RotationPlayer,
  shuffle,
  sortBySortKey,
} from './rotation';
import { chainPairs } from './chain';

/** 确定性 PRNG（mulberry32），便于洗牌类测试可复现。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players: RotationPlayer[] = [
  { userId: 'u-alpha', publicId: 5 },
  { userId: 'u-bravo', publicId: 2 },
  { userId: 'u-charlie', publicId: null },
  { userId: 'u-delta', publicId: 9 },
];

function take(state: ReturnType<typeof createRotation>, n: number, r: () => number) {
  return Array.from({ length: n }, () => nextDrawer(state, r));
}

describe('rotation 排序与队列', () => {
  it('sortBySortKey：数字 publicId 升序在前，缺省键（字符串）随后', () => {
    expect(sortBySortKey(players)).toEqual([
      'u-bravo', // publicId 2
      'u-alpha', // publicId 5
      'u-delta', // publicId 9
      'u-charlie', // 缺省 → userId 字符串
    ]);
  });

  it('id 规则：队列固定为升序，圈内不重复，跨圈沿用同一顺序', () => {
    const r = rng(1);
    const state = createRotation(players, 'id', r);
    const lap1 = take(state, 4, r);
    const lap2 = take(state, 4, r);
    expect(lap1).toEqual(sortBySortKey(players));
    expect(new Set(lap1).size).toBe(4);
    expect(lap2).toEqual(lap1);
  });

  it('lapShuffle 规则：每圈洗牌，圈内不重复，每圈都是全排列', () => {
    const r = rng(42);
    const state = createRotation(players, 'lapShuffle', r);
    const lap1 = take(state, 4, r);
    const lap2 = take(state, 4, r);
    expect(new Set(lap1).size).toBe(4);
    expect(new Set(lap2).size).toBe(4);
    expect([...lap1].sort()).toEqual([...lap2].sort());
    expect([...lap1].sort()).toEqual(sortBySortKey(players).sort());
    // 同一 seed 下首圈与次圈顺序不同（洗牌发生）
    expect(lap1).not.toEqual(lap2);
  });

  it('roundShuffle 规则：每回合对本圈未画过者重洗取头，圈内不重复', () => {
    const r = rng(7);
    const state = createRotation(players, 'roundShuffle', r);
    const lap1 = take(state, 4, r);
    expect(new Set(lap1).size).toBe(4);
    expect([...lap1].sort()).toEqual(sortBySortKey(players).sort());
  });

  it('roundShuffle 取空即圈结束：进入下一圈整圈重洗，不崩溃且再次全排列', () => {
    const r = rng(7);
    const state = createRotation(players, 'roundShuffle', r);
    const lap1 = take(state, 4, r);
    // 第 5 次调用时 drawn 已满 → 重建
    const lap2 = take(state, 5, r);
    expect(new Set(lap2.slice(0, 4)).size).toBe(4);
    expect([...lap2.slice(0, 4)].sort()).toEqual(
      sortBySortKey(players).sort(),
    );
    // 第二圈与第一圈都是全排列（成员一致）
    expect([...lap1].sort()).toEqual([...lap2.slice(0, 4)].sort());
  });

  it('shuffle 为纯函数：不修改原数组且返回等元素排列', () => {
    const src = [1, 2, 3, 4, 5];
    const out = shuffle(src, rng(3));
    expect(src).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
  });
});

describe('resolveRounds 回合计法解析', () => {
  it('byPlayers：按开局时人数解析', () => {
    expect(resolveRounds({ mode: 'byPlayers' }, 7)).toBe(7);
    expect(resolveRounds({ mode: 'byPlayers' }, 60)).toBe(60);
  });

  it('fixed：缺省 6，指定 value 生效', () => {
    expect(resolveRounds({ mode: 'fixed' }, 4)).toBe(6);
    expect(resolveRounds({ mode: 'fixed', value: 3 }, 4)).toBe(3);
  });

  it('custom：必须带 value', () => {
    expect(resolveRounds({ mode: 'custom', value: 12 }, 4)).toBe(12);
    expect(() => resolveRounds({ mode: 'custom' }, 4)).toThrow();
  });
});

describe('链序生成与 offset+1 换链', () => {
  it('buildChainOrder id：按 (publicId ?? sub) 升序', () => {
    expect(buildChainOrder(players, 'id', rng(1))).toEqual([
      'u-bravo',
      'u-alpha',
      'u-delta',
      'u-charlie',
    ]);
  });

  it('buildChainOrder 洗牌规则：开局洗一次，成员完整', () => {
    const order = buildChainOrder(players, 'lapShuffle', rng(9));
    expect([...order].sort()).toEqual(sortBySortKey(players).sort());
    const order2 = buildChainOrder(players, 'roundShuffle', rng(9));
    expect([...order2].sort()).toEqual(sortBySortKey(players).sort());
  });

  it('rotateChain：offset+1 左旋一位；负数/越界回绕', () => {
    expect(rotateChain(['a', 'b', 'c', 'd'], 0)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(rotateChain(['a', 'b', 'c', 'd'], 1)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
    expect(rotateChain(['a', 'b', 'c', 'd'], 5)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
    expect(rotateChain([], 1)).toEqual([]);
  });

  it('offset+1 换链后另一半作画（偶数 4 人）', () => {
    const order = ['p0', 'p1', 'p2', 'p3'];
    const chain1 = chainPairs(rotateChain(order, 0));
    const chain2 = chainPairs(rotateChain(order, 1));
    const drawers1 = chain1.map((s) => s.drawerId).sort();
    const drawers2 = chain2.map((s) => s.drawerId).sort();
    expect(drawers1).toEqual(['p0', 'p2']);
    expect(drawers2).toEqual(['p1', 'p3']);
    // 两链画者集合不相交 → 两条链后每人恰好作画一次、猜词一次
    expect(drawers1.filter((d) => drawers2.includes(d))).toEqual([]);
  });
});
