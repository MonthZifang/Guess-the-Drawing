import { useEffect, useRef, useState } from 'react';
import { Card } from '../ui';
import type { ChainEndData } from '../../lib/types';
import type { DrawBoardHandle } from './DrawBoard';

/** 每段回放 2–3 秒（规格） */
const SEG_DURATION = 2500;

const VOTE_OPTIONS = [
  { choice: 1, label: '完全一样', emoji: '👌' },
  { choice: 2, label: '有点跑偏', emoji: '🤔' },
  { choice: 3, label: '面目全非', emoji: '💥' },
] as const;

export interface VoteResultData {
  counts: [number, number, number];
  wordTrail: string[];
}

interface Props {
  boardRef: { current: DrawBoardHandle | null };
  data: ChainEndData;
  myVote: 1 | 2 | 3 | null;
  voteResult: VoteResultData | null;
  onVote: (choice: 1 | 2 | 3) => void;
}

/**
 * 链完成舞台：按段序回放笔迹（可暂停/跳过，段间显示 prompt 标签）
 * → 三档投票卡 → 已投状态 → vote:result 结果与词语演化链。
 * 舞台卸载（下一条链 round:start / game:end）由父组件负责。
 */
export function ChainStage({ boardRef, data, myVote, voteResult, onVote }: Props) {
  const [segIndex, setSegIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replayDone, setReplayDone] = useState(false);

  const pausedRef = useRef(false);
  const skipRef = useRef(false);

  useEffect(() => {
    pausedRef.current = false;
    skipRef.current = false;
    setPaused(false);
    setSegIndex(0);
    setReplayDone(false);

    const replay = data.replay;
    if (replay.length === 0) {
      setReplayDone(true);
      return;
    }

    let raf = 0;
    let seg = 0;
    let drawn = 0;
    let segStart = performance.now();
    let pausedAt: number | null = null;
    let finished = false;

    const flush = () => {
      const strokes = replay[seg]?.strokes ?? [];
      while (drawn < strokes.length) {
        boardRef.current?.applyStroke(strokes[drawn]);
        drawn++;
      }
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      flush();
      setReplayDone(true);
    };

    const startSeg = (i: number) => {
      seg = i;
      drawn = 0;
      boardRef.current?.clear();
      setSegIndex(i);
      segStart = performance.now();
      pausedAt = null;
      pausedRef.current = false;
      setPaused(false);
    };

    const advance = () => {
      flush();
      if (seg + 1 >= replay.length) finish();
      else startSeg(seg + 1);
    };

    const tick = (now: number) => {
      if (finished) return;
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) {
        if (pausedAt == null) pausedAt = now;
        return;
      }
      if (pausedAt != null) {
        segStart += now - pausedAt;
        pausedAt = null;
      }
      if (skipRef.current) {
        skipRef.current = false;
        advance();
        return;
      }
      const strokes = replay[seg].strokes;
      const progress = Math.min(1, (now - segStart) / SEG_DURATION);
      const target = Math.floor(progress * strokes.length);
      while (drawn < target) {
        boardRef.current?.applyStroke(strokes[drawn]);
        drawn++;
      }
      if (progress >= 1) advance();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, boardRef]);

  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }

  function skipSeg() {
    skipRef.current = true;
  }

  const curSeg = data.replay[segIndex];

  if (!replayDone) {
    return (
      <>
        {/* 段 prompt 标签（段间提示） */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
          <div className="pointer-events-auto rounded-full bg-white/95 px-4 py-2 text-center text-sm shadow-md ring-1 ring-sakura/30">
            <span className="font-bold text-sakura">
              第 {segIndex + 1}/{data.replay.length} 段回放
            </span>
            <span className="mx-2 text-ink/30">|</span>
            <span className="font-display text-stella break-all">
              {curSeg?.prompt || '（无题）'}
            </span>
          </div>
        </div>

        {/* 回放控制条 */}
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-2 bg-gradient-to-t from-ink/50 to-transparent px-3 py-3">
          <span className="mr-1 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-ink/70">
            🎬 链回放中
          </span>
          <button
            type="button"
            onClick={togglePause}
            className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-stella shadow-sm transition hover:brightness-105"
          >
            {paused ? '▶ 继续' : '⏸ 暂停'}
          </button>
          <button
            type="button"
            onClick={skipSeg}
            className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sakura shadow-sm transition hover:brightness-105"
          >
            {segIndex + 1 >= data.replay.length ? '跳过回放 ⏭' : '跳过本段 ⏭'}
          </button>
        </div>
      </>
    );
  }

  const myVoteLabel = VOTE_OPTIONS.find((v) => v.choice === myVote)?.label;

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/45 p-4 backdrop-blur-sm">
      <Card className="gd-pop w-full max-w-md p-5 text-center">
        <span className="text-2xl">🔗</span>
        <h3 className="font-display text-xl text-sakura">本条链完成！</h3>

        {!voteResult ? (
          <>
            <p className="mt-2 text-sm font-semibold text-ink/75">
              最终的词和最初的词还是同一个东西吗？
            </p>
            {myVote ? (
              <div className="mt-4 rounded-2xl bg-stella/10 px-4 py-3 text-sm font-bold text-stella">
                ✓ 已投：{myVoteLabel} · 等待其他玩家投票…
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {VOTE_OPTIONS.map((v) => (
                  <button
                    key={v.choice}
                    type="button"
                    onClick={() => onVote(v.choice)}
                    className="rounded-2xl border-2 border-ink/10 bg-white px-2 py-3 transition hover:-translate-y-0.5 hover:border-sakura/50 hover:shadow-md active:scale-95"
                  >
                    <span className="block text-xl">{v.emoji}</span>
                    <span className="mt-1 block text-xs font-bold text-ink/75">{v.label}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm font-semibold text-ink/75">
              最终的词和最初的词还是同一个东西吗？
            </p>
            <ul className="mt-3 space-y-1.5">
              {VOTE_OPTIONS.map((v, i) => (
                <li
                  key={v.choice}
                  className="flex items-center justify-between rounded-xl bg-bg px-3 py-1.5 text-sm"
                >
                  <span className={myVote === v.choice ? 'font-bold text-sakura' : 'text-ink/70'}>
                    {v.emoji} {v.label}
                    {myVote === v.choice && <span className="ml-1 text-xs">（我的票）</span>}
                  </span>
                  <span className="font-display text-stella">{voteResult.counts[i]} 票</span>
                </li>
              ))}
            </ul>
            {voteResult.wordTrail.length > 0 && (
              <div className="mt-3 rounded-2xl bg-stella/8 p-3 text-left ring-1 ring-stella/20">
                <p className="text-xs font-bold text-stella">词语演化链</p>
                <p className="mt-1 text-sm break-all text-ink/75">
                  {voteResult.wordTrail.join(' → ')}
                </p>
              </div>
            )}
            <p className="mt-3 text-xs text-ink/45">等待下一条链开始或对局结束…</p>
          </>
        )}
      </Card>
    </div>
  );
}
