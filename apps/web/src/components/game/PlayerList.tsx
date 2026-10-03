import { Avatar, Card } from '../ui';
import type { RoomPlayer } from '../../lib/types';

interface Props {
  players: RoomPlayer[];
  hostId?: string;
  drawerId?: string;
  myId?: string;
}

export function PlayerList({ players, hostId, drawerId, myId }: Props) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="font-display text-lg text-stella">玩家</h2>
        <span className="text-xs text-ink/45">{players.length}/60</span>
      </div>
      {/* 60 人上限：列表容器限高滚动 */}
      <ul className="gd-scroll max-h-[40vh] space-y-2 overflow-y-auto pr-1">
        {players.length === 0 && (
          <li className="rounded-xl bg-bg px-3 py-4 text-center text-sm text-ink/45">
            等待玩家加入…
          </li>
        )}
        {players.map((p) => {
          const isDrawer = !!drawerId && p.id === drawerId;
          const isHost = !!hostId && p.id === hostId;
          const isMe = !!myId && p.id === myId;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition ${
                isDrawer
                  ? 'bg-sakura/10 ring-2 ring-sakura/50 shadow-sm'
                  : 'bg-bg/70 hover:bg-bg'
              }`}
            >
              <Avatar user={{ username: p.username, avatarId: p.avatarId }} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{p.username}</span>
                  {isMe && (
                    <span className="shrink-0 rounded-full bg-stella/15 px-1.5 text-[10px] font-bold text-stella">
                      我
                    </span>
                  )}
                  {isHost && (
                    <span
                      className="shrink-0 text-[11px]"
                      title="房主"
                      aria-label="房主"
                    >
                      👑
                    </span>
                  )}
                </div>
                {isDrawer && (
                  <div className="text-[11px] font-bold text-sakura">★ 当前画者</div>
                )}
                {!isDrawer && p.guessed && !!drawerId && (
                  <div className="text-[11px] font-bold text-mint">✓ 已猜中</div>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-display text-sm text-stella shadow-sm">
                {p.score}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
