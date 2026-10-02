/** 计分纯函数：与存储/网络无关，便于单测。 */

/** 猜中者得分 = ceil(100 × 剩余秒 / 80)，下限 10。 */
export function guesserScore(
  remainingSeconds: number,
  roundSeconds = 80,
): number {
  const remaining = Math.max(0, remainingSeconds);
  const raw = Math.ceil((100 * remaining) / roundSeconds);
  return Math.max(raw, 10);
}

/** 画者得分 = 所有猜中者得分之和 × 25%（向下取整）。 */
export function drawerScore(guessedScores: number[]): number {
  const sum = guessedScores.reduce((acc, s) => acc + s, 0);
  return Math.floor(sum * 0.25);
}

/** 猜词规范化：去所有空白、全角转半角、忽略大小写。 */
export function normalizeGuessText(text: string): string {
  const noSpace = text.replace(/[\s　]+/g, '');
  const halfWidth = noSpace.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  return halfWidth.toLowerCase();
}

export interface RankInput {
  userId: string;
  score: number;
}

/**
 * 并列同名次的标准竞赛排名（1,2,2,4）。
 * 返回 Map<userId, rank>；分数相同按输入顺序并列。
 */
export function computeRanks(entries: RankInput[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const ranks = new Map<string, number>();
  let rank = 0;
  let prevScore: number | null = null;
  sorted.forEach((e, i) => {
    if (prevScore === null || e.score !== prevScore) {
      rank = i + 1;
      prevScore = e.score;
    }
    ranks.set(e.userId, rank);
  });
  return ranks;
}
