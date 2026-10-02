import { useEffect, useState } from 'react';
import type { RoundInfo } from '../../lib/types';

/** 立绘感装饰：自绘 chibi（纯 SVG，不依赖外部图片） */
function Chibi({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {/* 后发 */}
      <path
        d="M50 6C26 6 14 26 16 54c1 15 6 26 12 32 3-11 4-22 4-30 6 7 14 10 24 10s18-3 24-10c0 8 1 19 4 30 6-6 11-17 12-32C86 26 74 6 50 6Z"
        fill="#7b6cf6"
      />
      {/* 脸 */}
      <ellipse cx="50" cy="54" rx="23" ry="25" fill="#ffe9dc" />
      {/* 刘海 */}
      <path d="M27 46c4-17 14-28 23-28s19 11 23 28c-8-9-15-13-23-13s-15 4-23 13Z" fill="#9b8cff" />
      {/* 眼睛 */}
      <ellipse cx="41" cy="56" rx="4.4" ry="6.2" fill="#2e2645" />
      <ellipse cx="59" cy="56" rx="4.4" ry="6.2" fill="#2e2645" />
      <circle cx="42.6" cy="53.4" r="1.6" fill="#fff" />
      <circle cx="60.6" cy="53.4" r="1.6" fill="#fff" />
      {/* 腮红 */}
      <ellipse cx="33" cy="64" rx="5.5" ry="3.2" fill="#ffb3cd" opacity="0.85" />
      <ellipse cx="67" cy="64" rx="5.5" ry="3.2" fill="#ffb3cd" opacity="0.85" />
      {/* 嘴 */}
      <path d="M46 68q4 4 8 0" stroke="#2e2645" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* 蝴蝶结 */}
      <path d="M66 14l9-5 1 10 10 1-9 5-1-10-10-1Z" fill="#ff6fa5" />
      <circle cx="71" cy="19" r="3" fill="#ff9ec4" />
    </svg>
  );
}

interface Props {
  round: RoundInfo;
  isDrawer: boolean;
}

/**
 * 标志性瞬间 ②：回合开始的题目揭示卡。
 * 纯 CSS transform 翻转 + 自绘立绘卡；画者看到词（含类别），其他人看到字数提示。
 * 约 3.6 秒后自动消失，由父组件用 key={roundNo} 每回合重新挂载。
 */
export function RevealCard({ round, isDrawer }: Props) {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3600);
    return () => window.clearTimeout(t);
  }, []);

  if (gone) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center p-4">
      <div className="gd-perspective">
        <div className="gd-flip-card">
          {/* 正面：神秘题面 */}
          <div className="gd-face bg-[linear-gradient(150deg,#ff6fa5_0%,#7b6cf6_100%)] text-white">
            <div className="absolute inset-0 opacity-30">
              <span className="absolute left-5 top-5 text-2xl">🌸</span>
              <span className="absolute right-6 top-10 text-xl">✦</span>
              <span className="absolute bottom-8 left-8 text-xl">✦</span>
              <span className="absolute bottom-5 right-5 text-2xl">🌸</span>
            </div>
            <div className="relative flex h-full flex-col items-center justify-center gap-3">
              <span className="rounded-full bg-white/25 px-4 py-1 text-sm font-bold backdrop-blur">
                第 {round.roundNo} 回合 · 题目揭晓
              </span>
              <span className="font-display text-8xl drop-shadow-lg">?</span>
              <Chibi className="gd-bob h-24 w-24 drop-shadow-md" />
            </div>
          </div>

          {/* 背面：题面信息 */}
          <div className="gd-face gd-face-back bg-white">
            <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
              {isDrawer ? (
                <>
                  <span className="rounded-full bg-stella/10 px-4 py-1 text-sm font-bold text-stella">
                    你是本回合画者{round.category ? ` · ${round.category}` : ''}
                  </span>
                  <span className="font-display text-5xl leading-tight text-sakura break-all">
                    {round.word ?? '（词语未知）'}
                  </span>
                  <span className="text-sm text-ink/55">把你想到的画出来吧！</span>
                  <Chibi className="mt-1 h-20 w-20 opacity-90" />
                </>
              ) : (
                <>
                  <span className="rounded-full bg-sakura/10 px-4 py-1 text-sm font-bold text-sakura">
                    字数提示
                  </span>
                  <span className="font-display text-7xl text-stella">{round.charCount} 字</span>
                  <span className="text-sm text-ink/55">在聊天框输入完整词语即可猜中</span>
                  <Chibi className="mt-1 h-20 w-20 opacity-90" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
