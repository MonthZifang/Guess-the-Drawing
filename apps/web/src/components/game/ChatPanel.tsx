import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Card } from '../ui';
import type { ChatMsg } from '../../lib/types';

interface Props {
  messages: ChatMsg[];
  myId?: string;
  /** 回车 → 猜词；Shift+Enter → 闲聊 */
  onSend: (text: string, kind: 'guess' | 'chat') => void;
}

export function ChatPanel({ messages, myId, onSend }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit(kind: 'guess' | 'chat') {
    const t = text.trim();
    if (!t) return;
    onSend(t, kind);
    setText('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit('guess');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(e.shiftKey ? 'chat' : 'guess');
    }
  }

  return (
    <Card className="flex h-full min-h-[420px] flex-col p-4">
      <h2 className="mb-2 font-display text-lg text-sakura">聊天 · 猜词</h2>
      <div ref={listRef} className="gd-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-xs text-ink/40">
            输入词语即可猜题，也可以随便聊天～
          </p>
        )}
        {messages.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="my-1.5 text-center text-xs text-mint">
              {m.text}
            </div>
          ) : (
            <div
              key={m.id}
              className={`max-w-full rounded-2xl px-3 py-1.5 text-sm break-words ${
                m.playerId && m.playerId === myId
                  ? 'ml-6 bg-sakura/12 text-ink'
                  : 'mr-6 bg-ink/5 text-ink/80'
              }`}
            >
              <span className="font-semibold text-stella">{m.username ?? '玩家'}：</span>
              {m.text}
            </div>
          ),
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入答案或聊天…"
            maxLength={60}
            className="min-w-0 flex-1 rounded-2xl border-2 border-ink/10 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-ink/35 focus:border-sakura/60 focus:ring-4 focus:ring-sakura/15"
          />
          <button
            type="submit"
            className="shrink-0 rounded-2xl bg-sakura px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sakura/30 transition hover:brightness-105 active:scale-95"
          >
            猜词
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-ink/45">
          <span>
            <b className="text-sakura">回车</b> = 猜词 ·{' '}
            <b className="text-stella">Shift+回车</b> = 闲聊
          </span>
          <button
            type="button"
            onClick={() => submit('chat')}
            className="rounded-lg bg-stella/10 px-2 py-1 font-semibold text-stella transition hover:bg-stella/20"
          >
            发送为闲聊
          </button>
        </div>
      </form>
    </Card>
  );
}
