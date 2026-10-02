import { useCallback, useState } from 'react';

export interface ToastItem {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

let toastSeq = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: ToastItem['tone'] = 'error') => {
      const id = ++toastSeq;
      setToasts((list) => [...list.slice(-3), { id, text, tone }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`gd-pop pointer-events-auto rounded-2xl px-4 py-2.5 text-sm shadow-lg ${
            t.tone === 'error'
              ? 'bg-white/95 text-sakura border-2 border-sakura/40'
              : 'bg-white/95 text-mint border-2 border-mint/40'
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
