import {
  appendWordTrail,
  chainPairs,
  GUESS_NOT_ALLOWED,
  guessRejection,
  passPrompt,
  PASS_MAX_CHARS,
  segmentCount,
} from './chain';
import { rotateChain } from './rotation';

describe('chain 段配对推进', () => {
  it('偶数 4 人：floor(N/2)=2 段，偶位作画、奇位猜词', () => {
    const order = ['A', 'B', 'C', 'D'];
    expect(segmentCount(order.length)).toBe(2);
    expect(chainPairs(order)).toEqual([
      { drawerId: 'A', guesserId: 'B' },
      { drawerId: 'C', guesserId: 'D' },
    ]);
  });

  it('奇数 5 人：末段画者=链序[N-1]、猜词者=链序[0]（ceil(N/2)=3 段），全员出场', () => {
    const order = ['A', 'B', 'C', 'D', 'E'];
    expect(segmentCount(order.length)).toBe(3);
    const pairs = chainPairs(order);
    expect(pairs).toEqual([
      { drawerId: 'A', guesserId: 'B' },
      { drawerId: 'C', guesserId: 'D' },
      { drawerId: 'E', guesserId: 'A' },
    ]);
    const roles = new Set(pairs.flatMap((p) => [p.drawerId, p.guesserId]));
    expect([...roles].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('2 人：1 段（A 画 B 猜），B 作画发生在下一条链（offset+1）', () => {
    const order = ['A', 'B'];
    expect(segmentCount(2)).toBe(1);
    expect(chainPairs(order)).toEqual([{ drawerId: 'A', guesserId: 'B' }]);
    expect(chainPairs(rotateChain(order, 1))).toEqual([
      { drawerId: 'B', guesserId: 'A' },
    ]);
  });

  it('offset+1 换链后另一半作画', () => {
    const order = ['p0', 'p1', 'p2', 'p3'];
    const c1 = chainPairs(rotateChain(order, 0)).map((s) => s.drawerId);
    const c2 = chainPairs(rotateChain(order, 1)).map((s) => s.drawerId);
    expect([...c1].sort()).toEqual(['p0', 'p2']);
    expect([...c2].sort()).toEqual(['p1', 'p3']);
    expect(c1.some((d) => c2.includes(d))).toBe(false);
  });

  it('segmentCount 边界：少于 2 人为 0', () => {
    expect(segmentCount(0)).toBe(0);
    expect(segmentCount(1)).toBe(0);
    expect(segmentCount(2)).toBe(1);
    expect(segmentCount(60)).toBe(30);
  });
});

describe('chain 题目传导（传题）', () => {
  it('末条输入传导：规范化（trim/全角/空白/大小写）后作为下一段题目', () => {
    expect(passPrompt('原来词', 'xyz')).toBe('xyz');
    expect(passPrompt('原来词', '  XyZ ')).toBe('xyz');
    expect(passPrompt('原来词', '你好 世界')).toBe('你好世界');
    expect(passPrompt('原来词', 'ＸＹＺ')).toBe('xyz');
  });

  it('空输入续传：空串/纯空白/未提交 → 原题继续传导', () => {
    expect(passPrompt('原题', '')).toBe('原题');
    expect(passPrompt('原题', '   ')).toBe('原题');
    expect(passPrompt('原题', null)).toBe('原题');
    expect(passPrompt('原题', undefined)).toBe('原题');
  });

  it(`12 字截断：超长输入截到 ${PASS_MAX_CHARS} 字`, () => {
    const long = '一二三四五六七八九十十一十二十三十四';
    expect(long.length).toBeGreaterThan(PASS_MAX_CHARS);
    // 恰好 12 字不截
    const exact = '一二三四五六七八九十十一'; // 十/一 各占一字，共 12
    expect([...exact]).toHaveLength(PASS_MAX_CHARS);
    expect(passPrompt('原题', exact)).toBe(exact);
    // 超长只保留前 12 字
    const out = passPrompt('原题', long);
    expect([...out]).toHaveLength(PASS_MAX_CHARS);
    expect(out).toBe(exact);
    expect(passPrompt('原题', `${long}十五`)).toBe(exact);
  });
});

describe('chain 指定猜词者', () => {
  it('非指定猜词者拒绝（含画者与其他玩家）', () => {
    expect(guessRejection('user-B', 'user-A')).toBe(GUESS_NOT_ALLOWED);
    expect(guessRejection('user-B', 'user-B')).toBeNull();
    expect(guessRejection(null, 'user-A')).toBe(GUESS_NOT_ALLOWED);
  });
});

describe('chain wordTrail 累积', () => {
  it('初始为词库词，逐段累积传导文本', () => {
    let trail = ['词库词'];
    trail = appendWordTrail(trail, 'xyz');
    expect(trail).toEqual(['词库词', 'xyz']);
    trail = appendWordTrail(trail, 'abc');
    expect(trail).toEqual(['词库词', 'xyz', 'abc']);
  });

  it('与上一条规范化相等则不追加（空输入续传 / 猜中同词 / 大小写）', () => {
    expect(appendWordTrail(['词'], '词')).toEqual(['词']);
    expect(appendWordTrail(['词'], '')).toEqual(['词']);
    expect(appendWordTrail(['XyZ'], 'xyz')).toEqual(['XyZ']);
    // 非末条的重复仍允许（词语可以绕回）
    expect(appendWordTrail(['a', 'b'], 'a')).toEqual(['a', 'b', 'a']);
  });
});
