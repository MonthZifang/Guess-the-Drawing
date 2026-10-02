import { useEffect, useState } from 'react';
import { NavBar } from '../components/NavBar';
import { Card, PageTitle, Avatar } from '../components/ui';
import { api } from '../lib/api';
import type { User } from '../lib/types';

interface LeaderRow {
  rank: number;
  username: string;
  avatarId?: number | string;
  totalScore: number;
}

type Any = Record<string, any>;

function normalize(data: unknown): LeaderRow[] {
  const root = (data ?? {}) as Any;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(root.leaderboard)
      ? root.leaderboard
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.players)
          ? root.players
          : [];
  const rows: LeaderRow[] = arr.map((p: Any, i: number) => ({
    rank: Number(p.rank ?? p.position ?? 0) || i + 1,
    username: String(p.username ?? p.name ?? '???'),
    avatarId: p.avatarId ?? p.avatar,
    totalScore: Number(p.totalScore ?? p.score ?? p.total ?? p.points ?? 0) || 0,
  }));
  rows.sort((a, b) => a.rank - b.rank || b.totalScore - a.totalScore);
  return rows;
}

const medal = ['🥇', '🥈', '🥉'];

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let alive = true;
    api<unknown>('/leaderboard')
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

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <PageTitle>🏆 总分排行榜</PageTitle>
          <span className="text-sm text-ink/45">Top 10</span>
        </div>

        {state === 'loading' && <Card className="p-10 text-center text-ink/50">加载中…</Card>}
        {state === 'error' && <Card className="p-10 text-center text-sakura">{errMsg}</Card>}
        {state === 'ready' && rows.length === 0 && (
          <Card className="p-10 text-center text-ink/50">暂无排名数据，快去打第一场！</Card>
        )}

        {top3.length > 0 && (
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {top3.map((r) => (
              <Card
                key={r.rank}
                className={`flex flex-col items-center gap-2 p-6 text-center gd-pop ${
                  r.rank === 1 ? 'sm:-translate-y-2 ring-2 ring-star/60' : ''
                }`}
              >
                <span className="text-4xl">{medal[r.rank - 1] ?? `#${r.rank}`}</span>
                <Avatar user={{ username: r.username, avatarId: r.avatarId } as User} size={64} />
                <span className="font-display text-xl">{r.username}</span>
                <span className="rounded-full bg-sakura/10 px-4 py-1 font-display text-sakura">
                  {r.totalScore} 分
                </span>
              </Card>
            ))}
          </div>
        )}

        {rest.length > 0 && (
          <Card className="divide-y divide-ink/5 p-2">
            {rest.map((r) => (
              <div key={r.rank} className="flex items-center gap-4 px-4 py-3">
                <span className="w-10 text-center font-display text-lg text-ink/50">#{r.rank}</span>
                <Avatar user={{ username: r.username, avatarId: r.avatarId } as User} size={36} />
                <span className="min-w-0 flex-1 truncate font-semibold">{r.username}</span>
                <span className="font-display text-stella">{r.totalScore} 分</span>
              </div>
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
