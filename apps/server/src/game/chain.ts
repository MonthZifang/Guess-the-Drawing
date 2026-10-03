/**
 * 链式画猜纯函数：段配对、题目传导、wordTrail 累积、指定猜词者校验。
 *
 * 段配对：段 i → drawer = 链序[2i]、guesser = 链序[2i+1]；
 * 段数 = floor(N/2) 对 + 奇数 N 末段（猜词者取链序[0]，即 ceil(N/2) 段），
 * 全员在链中出场（偶位作画、奇位猜词）。
 */

import { normalizeGuessText } from './scoring';

export const PASS_MAX_CHARS = 12;
/** 非指定猜词者提交时的错误消息（规格原文）。 */
export const GUESS_NOT_ALLOWED = '本回合由指定玩家猜词';

export interface SegmentRole {
  drawerId: string;
  guesserId: string;
}

/** 单链段数：floor(N/2) 对 + 奇数 N 末段。 */
export function segmentCount(playerCount: number): number {
  if (playerCount < 2) return 0;
  return Math.ceil(playerCount / 2);
}

/** 按链序两两成对生成段角色（奇数 N 末段猜词者 = 链序[0]）。 */
export function chainPairs(chainOrder: readonly string[]): SegmentRole[] {
  const n = chainOrder.length;
  const roles: SegmentRole[] = [];
  for (let i = 0; i < segmentCount(n); i += 1) {
    const drawerIdx = 2 * i;
    const guesserIdx = 2 * i + 1;
    roles.push({
      drawerId: chainOrder[drawerIdx],
      guesserId:
        guesserIdx < n ? chainOrder[guesserIdx] : chainOrder[0],
    });
  }
  return roles;
}

/**
 * 题目传导：取猜词者末条提交 → 规范化（trim/全角转半角/去空白/小写）→
 * 12 字截断；输入为空则原题继续传导。
 */
export function passPrompt(
  prevPrompt: string,
  lastInput: string | null | undefined,
): string {
  const raw = (lastInput ?? '').trim();
  if (!raw) return prevPrompt;
  const norm = normalizeGuessText(raw);
  if (!norm) return prevPrompt;
  return [...norm].slice(0, PASS_MAX_CHARS).join('');
}

/** wordTrail 累积：与上一条规范化相等则不追加。 */
export function appendWordTrail(
  trail: readonly string[],
  text: string,
): string[] {
  const next = [...trail];
  const norm = normalizeGuessText(text);
  if (!norm) return next;
  const last = next[next.length - 1];
  if (last !== undefined && normalizeGuessText(last) === norm) {
    return next;
  }
  next.push(text);
  return next;
}

/** 仅指定猜词者可提交；否则返回错误消息。 */
export function guessRejection(
  guesserId: string | null | undefined,
  userId: string,
): string | null {
  if (guesserId && guesserId === userId) return null;
  return GUESS_NOT_ALLOWED;
}
