import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StrokeEvent } from '../../lib/types';

export const BOARD_W = 1024;
export const BOARD_H = 768;
export const STROKE_WIDTH = 6;

export interface DrawBoardHandle {
  applyStroke: (s: StrokeEvent) => void;
  clear: () => void;
}

interface Props {
  enabled: boolean;
  color: string;
  onStroke: (s: StrokeEvent) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  petal: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 画板：逻辑尺寸 1024×768，容器内自适应缩放。
 * - 指针事件（pointerdown/move/up + setPointerCapture）出笔，相对坐标 0–1 传输
 * - down=true 为起笔（beginPath），down=false 为延续（lineTo）
 * - 标志性瞬间 ①：沿笔迹生成樱花样式的粒子尾迹（独立叠加层，rAF 渐隐）
 * 收到的 stroke 仅重绘（不重复生成粒子，本地出笔时才生成）。
 */
export const DrawBoard = forwardRef<DrawBoardHandle, Props>(function DrawBoard(
  { enabled, color, onStroke },
  ref,
) {
  const mainRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const colorRef = useRef(color);
  const enabledRef = useRef(enabled);
  const partsRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  colorRef.current = color;
  enabledRef.current = enabled;

  function clearBoards() {
    const main = mainRef.current;
    if (main) main.getContext('2d')?.clearRect(0, 0, BOARD_W, BOARD_H);
    const fx = fxRef.current;
    if (fx) fx.getContext('2d')?.clearRect(0, 0, BOARD_W, BOARD_H);
    partsRef.current = [];
  }

  function drawStroke(s: StrokeEvent) {
    const ctx = mainRef.current?.getContext('2d');
    if (!ctx) return;
    const x = clamp01(s.x) * BOARD_W;
    const y = clamp01(s.y) * BOARD_H;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.down) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  function spawnParticles(x: number, y: number, hex: string, count: number) {
    const px = clamp01(x) * BOARD_W;
    const py = clamp01(y) * BOARD_H;
    const list = partsRef.current;
    for (let i = 0; i < count; i++) {
      if (list.length >= 240) list.shift();
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 1.4;
      list.push({
        x: px + (Math.random() - 0.5) * 6,
        y: py + (Math.random() - 0.5) * 6,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 0.6,
        life: 0,
        maxLife: 34 + Math.random() * 26,
        size: 3 + Math.random() * 5,
        color: Math.random() < 0.35 ? '#ffb3cd' : hex,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.25,
        petal: Math.random() < 0.55,
      });
    }
    ensureLoop();
  }

  function ensureLoop() {
    if (rafRef.current != null) return;
    const step = () => {
      rafRef.current = null;
      const fx = fxRef.current;
      const ctx = fx?.getContext('2d');
      const list = partsRef.current;
      if (!ctx || list.length === 0) {
        if (fx) ctx?.clearRect(0, 0, BOARD_W, BOARD_H);
        return;
      }
      ctx.clearRect(0, 0, BOARD_W, BOARD_H);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life += 1;
        if (p.life >= p.maxLife) {
          list.splice(i, 1);
          continue;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045;
        p.vx *= 0.985;
        p.rot += p.vr;
        const alpha = 1 - p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.petal) {
          // 樱花瓣：旋转的椭圆
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      applyStroke: (s: StrokeEvent) => drawStroke(s),
      clear: () => clearBoards(),
    }),
    [],
  );

  function toNorm(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }

  function handleDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!enabledRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = toNorm(e);
    lastRef.current = p;
    const ev: StrokeEvent = { ...p, color: colorRef.current, width: STROKE_WIDTH, down: true };
    drawStroke(ev);
    spawnParticles(p.x, p.y, colorRef.current, 3);
    onStroke(ev);
  }

  function handleMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!enabledRef.current || !drawingRef.current) return;
    const p = toNorm(e);
    const last = lastRef.current;
    // 节流：逻辑坐标位移 < 2px 不发送
    if (last && Math.hypot(p.x * BOARD_W - last.x * BOARD_W, p.y * BOARD_H - last.y * BOARD_H) < 2.5) {
      return;
    }
    lastRef.current = p;
    const ev: StrokeEvent = { ...p, color: colorRef.current, width: STROKE_WIDTH, down: false };
    drawStroke(ev);
    spawnParticles(p.x, p.y, colorRef.current, 1);
    onStroke(ev);
  }

  function handleUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border-2 border-ink/10 bg-white shadow-inner"
      style={{ aspectRatio: '4 / 3', touchAction: 'none' }}
    >
      <canvas
        ref={mainRef}
        width={BOARD_W}
        height={BOARD_H}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: enabled ? 'crosshair' : 'default' }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={(e) => {
          if (drawingRef.current) handleUp(e);
        }}
      />
      <canvas
        ref={fxRef}
        width={BOARD_W}
        height={BOARD_H}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {!enabled && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/5 to-transparent px-4 py-2 text-center text-xs text-ink/40">
          等待画者作画…
        </div>
      )}
    </div>
  );
});
