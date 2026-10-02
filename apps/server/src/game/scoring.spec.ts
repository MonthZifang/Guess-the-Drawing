import {
  computeRanks,
  drawerScore,
  guesserScore,
  normalizeGuessText,
} from './scoring';

describe('guesserScore（剩余时间 → 得分曲线）', () => {
  it('满时（剩余 80 秒）得 100 分', () => {
    expect(guesserScore(80)).toBe(100);
  });

  it('一半时间得 50 分（向上取整）', () => {
    expect(guesserScore(40)).toBe(50);
    expect(guesserScore(41)).toBe(52); // ceil(100*41/80)=ceil(51.25)=52
    expect(guesserScore(39)).toBe(49); // ceil(48.75)=49
  });

  it('最后 1 秒触达下限 10（ceil 结果 2 被抬到 10）', () => {
    expect(guesserScore(1)).toBe(10);
    expect(guesserScore(0.5)).toBe(10);
    expect(guesserScore(0)).toBe(10);
  });

  it('负剩余时间按 0 处理，仍为下限 10', () => {
    expect(guesserScore(-3)).toBe(10);
  });

  it('79 秒 = 99 分', () => {
    expect(guesserScore(79)).toBe(99);
  });
});

describe('drawerScore（画者 25% 向下取整）', () => {
  it('单人猜中 100 → 25', () => {
    expect(drawerScore([100])).toBe(25);
  });

  it('多猜中者求和后取 25%：100+80=180 → 45', () => {
    expect(drawerScore([100, 80])).toBe(45);
  });

  it('总和 41 → floor(10.25)=10', () => {
    expect(drawerScore([10, 10, 10, 11])).toBe(10);
  });

  it('无人猜中 → 0', () => {
    expect(drawerScore([])).toBe(0);
  });

  it('总和 11 → floor(2.75)=2（向下取整）', () => {
    expect(drawerScore([11])).toBe(2);
  });
});

describe('normalizeGuessText（猜词规范化）', () => {
  it('去空格（含全角空格）', () => {
    expect(normalizeGuessText(' 冷 冻 　液 ')).toBe('冷冻液');
  });

  it('全角转半角', () => {
    expect(normalizeGuessText('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeGuessText('！')).toBe('!');
  });

  it('忽略大小写', () => {
    expect(normalizeGuessText('Copper')).toBe('copper');
    expect(normalizeGuessText('COPPER')).toBe('copper');
  });

  it('与目标词完全匹配判定', () => {
    expect(normalizeGuessText('　巨浪 合金　')).toBe(normalizeGuessText('巨浪合金'));
    expect(normalizeGuessText('巨浪合金')).not.toBe(normalizeGuessText('巨浪'));
  });
});

describe('computeRanks（总分排名）', () => {
  it('分数降序排名', () => {
    const ranks = computeRanks([
      { userId: 'a', score: 10 },
      { userId: 'b', score: 30 },
      { userId: 'c', score: 20 },
    ]);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
    expect(ranks.get('a')).toBe(3);
  });

  it('并列同名次（1,2,2,4）', () => {
    const ranks = computeRanks([
      { userId: 'a', score: 30 },
      { userId: 'b', score: 30 },
      { userId: 'c', score: 20 },
      { userId: 'd', score: 10 },
    ]);
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(3);
    expect(ranks.get('d')).toBe(4);
  });
});
