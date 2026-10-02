import {
  buildWordList,
  categoryFromKey,
  difficultyOf,
  isAcceptableWord,
  parseProperties,
  unescapeProperties,
} from './word-rules';

describe('parseProperties', () => {
  it('解析 key=value 与 key:value，忽略注释和空行', () => {
    const text = [
      '# 注释',
      '! 注释2',
      '',
      'item.copper.name = 铜',
      'block.grass.name=草地',
      '  liquid.oil.name : 石油  ',
    ].join('\n');
    expect(parseProperties(text)).toEqual([
      ['item.copper.name', '铜'],
      ['block.grass.name', '草地'],
      ['liquid.oil.name', '石油'],
    ]);
  });

  it('处理转义与行尾续行', () => {
    const text = 'a.b = 前半\\n后半\nc.d = 软\\ 续\\\n行\n';
    expect(parseProperties(text)).toEqual([
      ['a.b', '前半\n后半'],
      ['c.d', '软 续行'],
    ]);
  });

  it('值中的等号不切断 key（按首个未转义分隔符）', () => {
    expect(parseProperties('k = a\\=b')).toEqual([['k', 'a=b']]);
  });
});

describe('unescapeProperties', () => {
  it('还原常见转义与 \\uXXXX', () => {
    expect(unescapeProperties('\\t\\u4e2d')).toBe('\t中');
    expect(unescapeProperties('\\\\')).toBe('\\');
  });
});

describe('categoryFromKey', () => {
  it('按前缀映射类别', () => {
    expect(categoryFromKey('block.grass.name')).toBe('BUILDING');
    expect(categoryFromKey('unit.dagger.name')).toBe('UNIT');
    expect(categoryFromKey('liquid.water.name')).toBe('LIQUID');
    expect(categoryFromKey('item.copper.name')).toBe('ITEM');
    expect(categoryFromKey('item.phase-fabric.name')).toBe('ITEM');
  });

  it('排除 description/details/非 .name 及未知前缀', () => {
    expect(categoryFromKey('block.grass.description')).toBeNull();
    expect(categoryFromKey('item.copper.details')).toBeNull();
    expect(categoryFromKey('unit.blocks')).toBeNull();
    expect(categoryFromKey('enemy.foo.name')).toBeNull();
  });
});

describe('isAcceptableWord', () => {
  it('接受 2–6 个汉字', () => {
    expect(isAcceptableWord('冷冻液')).toBe(true);
    expect(isAcceptableWord('巨浪合金')).toBe(true);
    expect(isAcceptableWord('鹅卵石')).toBe(true);
  });
  it('剔除含英文字母/数字/标点的值', () => {
    expect(isAcceptableWord('copper')).toBe(false);
    expect(isAcceptableWord('钛3')).toBe(false);
    expect(isAcceptableWord('冷冻-液')).toBe(false);
    expect(isAcceptableWord('[scarlet]矿渣')).toBe(false);
    expect(isAcceptableWord('冷冻液{0}')).toBe(false);
  });
  it('剔除 1 字与超过长度上限的值', () => {
    expect(isAcceptableWord('水')).toBe(false);
    expect(isAcceptableWord('一二三四五六七')).toBe(false);
    expect(isAcceptableWord('一二三四五六七', 7)).toBe(true);
  });
});

describe('difficultyOf', () => {
  it('2–3字=1、4字=2、5–6字=3，7字回落为3', () => {
    expect(difficultyOf(2)).toBe(1);
    expect(difficultyOf(3)).toBe(1);
    expect(difficultyOf(4)).toBe(2);
    expect(difficultyOf(5)).toBe(3);
    expect(difficultyOf(6)).toBe(3);
    expect(difficultyOf(7)).toBe(3);
  });
});

describe('buildWordList', () => {
  const entries: Array<[string, string]> = [
    ['block.grass.name', '草地'],
    ['block.grass.description', '一片草地'],
    ['unit.dagger.name', '尖刀'],
    ['liquid.water.name', '水'], // 1 字，剔除
    ['liquid.oil.name', '石油'],
    ['item.copper.name', '铜'], // 1 字，剔除
    ['item.coal.name', '煤炭'],
    ['block.pooled-cryofluid.name', '冷冻液'],
    ['liquid.cryofluid.name', '冷冻液'], // 跨类别重名 → 保留 LIQUID
    ['block.bad1.name', 'abc'],
    ['block.bad2.name', '钛2'],
    ['block.iron-wall.name', '钢铁墙垣'], // 4 字 → 难度 2
  ];

  it('过滤、分类、难度与跨类别去重', () => {
    const { words, counts } = buildWordList(entries, { targetPerCategory: 1 });
    expect(words.map((w) => w.text).sort()).toEqual(
      ['冷冻液', '煤炭', '石油', '尖刀', '草地', '钢铁墙垣'].sort(),
    );
    expect(words.find((w) => w.text === '冷冻液')!.category).toBe('LIQUID');
    expect(words.find((w) => w.text === '草地')!.category).toBe('BUILDING');
    expect(words.find((w) => w.text === '尖刀')!.difficulty).toBe(1);
    expect(words.find((w) => w.text === '钢铁墙垣')!.difficulty).toBe(2);
    expect(words.find((w) => w.text === '钢铁墙垣')!.category).toBe('BUILDING');
    expect(counts.LIQUID).toBe(2);
    expect(counts.BUILDING).toBe(2);
    expect(counts.UNIT).toBe(1);
    expect(counts.ITEM).toBe(1);
  });

  it('任一类别不足目标时放宽到 7 字', () => {
    const long: Array<[string, string]> = [
      ['block.a.name', '七六五四三二一'],
      ['unit.a.name', '一二三四五六'],
      ['liquid.a.name', '甲乙丙丁戊己庚'],
      ['item.a.name', '一二三四五六七'],
    ];
    const strict = buildWordList(long, { targetPerCategory: 40 });
    expect(strict.maxNameLength).toBe(7);
    expect(strict.words).toHaveLength(4);
    expect(strict.warnings.length).toBeGreaterThan(0);
  });

  it('输出确定性顺序（按类别分组），且仅含 text/category/difficulty', () => {
    const a = buildWordList(entries, { targetPerCategory: 1 }).words;
    const b = buildWordList(entries, { targetPerCategory: 1 }).words;
    expect(a).toEqual(b);
    const cats = a.map((w) => w.category);
    expect(cats).toEqual([...cats].sort((x, y) => cats.indexOf(x) - cats.indexOf(y)));
    for (const w of a) {
      expect(Object.keys(w).sort()).toEqual(['category', 'difficulty', 'text']);
    }
  });
});
