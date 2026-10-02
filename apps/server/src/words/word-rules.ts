export type WordCategory = 'BUILDING' | 'UNIT' | 'LIQUID' | 'ITEM';

export const WORD_CATEGORIES: readonly WordCategory[] = [
  'BUILDING',
  'UNIT',
  'LIQUID',
  'ITEM',
];

export interface ExtractedWord {
  text: string;
  category: WordCategory;
  difficulty: 1 | 2 | 3;
}

const CATEGORY_BY_PREFIX: Record<string, WordCategory> = {
  block: 'BUILDING',
  unit: 'UNIT',
  liquid: 'LIQUID',
  item: 'ITEM',
};

/** 跨类别重名时优先保留更具体的类别（如 block 与 liquid 同名保留 LIQUID）。 */
const CATEGORY_RANK: Record<WordCategory, number> = {
  LIQUID: 0,
  ITEM: 1,
  UNIT: 2,
  BUILDING: 3,
};

const NAME_KEY_RE = /^(block|unit|liquid|item)\..+\.name$/;
const HAN_RE = /^[一-龥]+$/;

/** 解析 Java properties：key=value / key:value，支持转义与行尾续行；按文件顺序返回。 */
export function parseProperties(text: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const lines = text.split(/\r\n|\n|\r/);
  let pending = '';
  for (const rawLine of lines) {
    let line = rawLine;
    if (pending !== '') {
      line = pending + line;
      pending = '';
    }
    // 行尾奇数个反斜杠 => 续行（去掉该反斜杠）
    const trailing = /((?:\\)*)$/.exec(line);
    if (trailing && trailing[1].length % 2 === 1) {
      pending = line.slice(0, -1);
      continue;
    }
    const trimmed = line.replace(/^[\s﻿]+/, '');
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }
    const sepIdx = findUnescaped(trimmed, '=');
    const colonIdx = findUnescaped(trimmed, ':');
    const idx = [sepIdx, colonIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (idx === undefined) {
      continue;
    }
    const key = unescapeProperties(trimmed.slice(0, idx)).trim();
    const value = unescapeProperties(trimmed.slice(idx + 1)).trim();
    if (key !== '') {
      entries.push([key, value]);
    }
  }
  return entries;
}

function findUnescaped(s: string, ch: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === ch) {
      return i;
    }
  }
  return -1;
}

export function unescapeProperties(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, esc: string) => {
    if (esc.startsWith('u')) {
      return String.fromCharCode(parseInt(esc.slice(1), 16));
    }
    switch (esc) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case 'f':
        return '\f';
      default:
        return esc;
    }
  });
}

/** key 形如 block.xxx.name / unit.xxx.name → 类别；description/details/无 .name 后缀一律排除。 */
export function categoryFromKey(key: string): WordCategory | null {
  const m = NAME_KEY_RE.exec(key);
  if (!m) {
    return null;
  }
  return CATEGORY_BY_PREFIX[m[1]] ?? null;
}

/** 仅接受纯汉字、长度在 [minLen, maxLen] 的值（自动剔除数字/字母/标点/颜色标签）。 */
export function isAcceptableWord(text: string, maxLen = 6, minLen = 2): boolean {
  const t = text.trim();
  if (t.length < minLen || t.length > maxLen) {
    return false;
  }
  return HAN_RE.test(t);
}

/** 2–3 字=1（易），4 字=2（中），5 字及以上=3（难）。 */
export function difficultyOf(charCount: number): 1 | 2 | 3 {
  if (charCount <= 3) {
    return 1;
  }
  if (charCount === 4) {
    return 2;
  }
  return 3;
}

export interface BuildWordListOptions {
  /** 每类目标词数，不足时先把最大字数放宽到 7（默认 40）。 */
  targetPerCategory?: number;
}

export interface BuildWordListResult {
  words: ExtractedWord[];
  counts: Record<WordCategory, number>;
  maxNameLength: number;
  warnings: string[];
}

function attemptBuild(
  entries: Iterable<readonly [string, string]>,
  maxLen: number,
): { words: ExtractedWord[]; counts: Record<WordCategory, number> } {
  interface Cand extends ExtractedWord {
    order: number;
  }
  const byText = new Map<string, Cand>();
  let order = 0;
  for (const [key, value] of entries) {
    const category = categoryFromKey(key);
    if (!category) {
      continue;
    }
    const text = value.trim();
    if (!isAcceptableWord(text, maxLen)) {
      continue;
    }
    const cand: Cand = {
      text,
      category,
      difficulty: difficultyOf(text.length),
      order: order++,
    };
    const prev = byText.get(text);
    if (!prev || CATEGORY_RANK[category] < CATEGORY_RANK[prev.category]) {
      byText.set(text, cand);
    }
  }
  const catOrder = new Map(WORD_CATEGORIES.map((c, i) => [c, i]));
  const words = [...byText.values()]
    .sort(
      (a, b) =>
        (catOrder.get(a.category) ?? 99) - (catOrder.get(b.category) ?? 99) ||
        a.order - b.order,
    )
    .map(({ text, category, difficulty }) => ({ text, category, difficulty }));
  const counts = Object.fromEntries(
    WORD_CATEGORIES.map((c) => [c, 0]),
  ) as Record<WordCategory, number>;
  for (const w of words) {
    counts[w.category] += 1;
  }
  return { words, counts };
}

/**
 * 全量流水线：前缀+.name 过滤 → 2–6 字纯汉字过滤 → 跨类别去重；
 * 若任一类别不足 targetPerCategory，放宽到 7 字重跑一次。
 */
export function buildWordList(
  entries: Iterable<readonly [string, string]>,
  options: BuildWordListOptions = {},
): BuildWordListResult {
  const target = options.targetPerCategory ?? 40;
  let result = attemptBuild(entries, 6);
  let maxNameLength = 6;
  const short = WORD_CATEGORIES.filter((c) => result.counts[c] < target);
  if (short.length > 0) {
    const relaxed = attemptBuild(entries, 7);
    if (
      WORD_CATEGORIES.every((c) => relaxed.counts[c] >= target) ||
      Object.values(relaxed.counts).reduce((a, b) => a + b, 0) >
        Object.values(result.counts).reduce((a, b) => a + b, 0)
    ) {
      result = relaxed;
      maxNameLength = 7;
    }
  }
  const warnings: string[] = [];
  for (const c of WORD_CATEGORIES) {
    if (result.counts[c] < target) {
      warnings.push(
        `类别 ${c} 仅 ${result.counts[c]} 词，低于目标 ${target}（受源词条数量限制）`,
      );
    }
  }
  return { ...result, maxNameLength, warnings };
}
