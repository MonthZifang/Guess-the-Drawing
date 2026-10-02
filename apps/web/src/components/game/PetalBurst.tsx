import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';

const PETAL_COLORS = ['#ff6fa5', '#ffb3cd', '#7b6cf6', '#3ecfa0', '#ffd93d', '#ffffff'];

interface Props {
  id: number;
  onDone: (id: number) => void;
}

/**
 * 标志性瞬间 ③：猜对时的彩带/花瓣飘落。
 * 轻量 DOM + CSS keyframes，约 3 秒后自我清理（父组件调 onDone 移除）。
 */
export function PetalBurst({ id, onDone }: Props) {
  useEffect(() => {
    const t = window.setTimeout(() => onDone(id), 3200);
    return () => window.clearTimeout(t);
  }, [id, onDone]);

  const petals = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        sway: (Math.random() - 0.5) * 220,
        spin: 360 + Math.random() * 720,
        dur: 2 + Math.random() * 1.6,
        delay: Math.random() * 0.7,
        size: 9 + Math.random() * 9,
        color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
      })),
    [id],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
      {petals.map((p) => (
        <span
          key={p.key}
          className="gd-petal"
          style={
            {
              left: `${p.left}vw`,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              '--sway': `${p.sway}px`,
              '--spin': `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
