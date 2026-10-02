import { useEffect, useState } from 'react';
import { NavBar } from '../components/NavBar';
import { Card, PageTitle } from '../components/ui';
import { api } from '../lib/api';

interface MatchPlayerRow {
  username: string;
  score: number;
  rank: number;
}

interface MatchRow {
  roomCode: string;
  time: string;
  players: MatchPlayerRow[];
}

type Any = Record<string, any>;

function normalize(data: unknown): MatchRow[] {
  const root = (data ?? {}) as Any;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(root.matches)
      ? root.matches
      : Array.isArray(root.items)
        ? root.items
        : [];
  return arr.map((m: Any, i: number) => {
    const rawPlayers: Any[] = (m.players ?? m.matchPlayers ?? m.scores ?? []) as Any[];
    const players: MatchPlayerRow[] = rawPlayers.map((p, j) => ({
      username: String(p.username ?? p.name ?? `玩家${j + 1}`),
      score: Number(p.score ?? p.totalScore ?? p.points ?? 0) || 0,
      rank: Number(p.rank ?? p.position ?? 0) || j + 1,
    }));
    players.sort((a, b) => (a.rank || b.rank ? a.rank - b.rank : b.score - a.score));
    players.forEach((p, j) => {
      if (!p.rank) p.rank = j + 1;
    });
    const endedAt = m.endedAt ?? m.createdAt ?? m.time;
    const t = endedAt ? new Date(endedAt) : null;
    return {
      roomCode: String(m.roomCode ?? m.code ?? `#${i + 1}`),
      time: t && !Number.isNaN(t.getTime()) ? t.toLocaleString('zh-CN', { hour12: false }) : '—',
      players,
    };
  });
}

const medal = ['🥇', '🥈', '🥉'];

export default function History() {
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let alive = true;
    api<unknown>('/matches/recent')
      .then((data) => {
        if (!alive) return;
        setRows(normalize(data));
        setState('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setErrMsg(err instanceof Error ? err.message : '加载失败');
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <PageTitle>🕘 对局历史</PageTitle>
          <span className="text-sm text-ink/45">最近 20 场</span>
        </div>

        {state === 'loading' && (
          <Card className="p-10 text-center text-ink/50">加载中…</Card>
        )}
        {state === 'error' && (
          <Card className="p-10 text-center text-sakura">{errMsg}</Card>
        )}
        {state === 'ready' && rows.length === 0 && (
          <Card className="p-10 text-center text-ink/50">还没有对局记录，先去开一局吧！</Card>
        )}

        <div className="space-y-4">
          {rows.map((m, i) => (
            <Card key={`${m.roomCode}-${i}`} className="p-5 gd-pop">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-stella/10 px-3 py-1 font-mono text-sm font-bold text-stella">
                  房间 {m.roomCode}
                </span>
                <span className="text-sm text-ink/50">{m.time}</span>
                <span className="ml-auto text-sm text-ink/40">{m.players.length} 名玩家</span>
              </div>
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {m.players.map((p) => (
                  <li
                    key={`${p.rank}-${p.username}`}
                    className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2 text-sm"
                  >
                    <span className="w-7 text-center">{medal[p.rank - 1] ?? `#${p.rank}`}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.username}</span>
                    <span className="font-display text-stella">{p.score} 分</span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
