import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { ChatPanel } from '../components/game/ChatPanel';
import { DrawBoard } from '../components/game/DrawBoard';
import type { DrawBoardHandle } from '../components/game/DrawBoard';
import { PetalBurst } from '../components/game/PetalBurst';
import { PlayerList } from '../components/game/PlayerList';
import { RevealCard } from '../components/game/RevealCard';
import { ToastStack, useToasts } from '../components/Toasts';
import { Avatar, Button, Card } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  errorMessage,
  normalizeChat,
  normalizeResults,
  normalizeRoomState,
  normalizeRoundStart,
  normalizeScores,
  normalizeStroke,
  normalizeTimer,
} from '../lib/types';
import type { ChatMsg, ResultRow, RoomPlayer, RoomState, RoundInfo, RoundScore, StrokeEvent } from '../lib/types';

type Phase = 'waiting' | 'playing' | 'roundEnd' | 'gameEnd';

const PALETTE = [
  { name: '樱粉', hex: '#ff6fa5' },
  { name: '星紫', hex: '#7b6cf6' },
  { name: '墨', hex: '#2e2645' },
  { name: '薄荷', hex: '#3ecfa0' },
  { name: '白', hex: '#ffffff' },
  { name: '黄', hex: '#ffd93d' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

let msgSeq = 0;
let burstSeq = 0;

interface EchoEntry {
  text: string;
  at: number;
}

function extractPlayer(raw: unknown): RoomPlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, any>;
  const src = (root.player ?? root) as Record<string, any>;
  const id =
    typeof src.id === 'string' && src.id
      ? src.id
      : typeof src.userId === 'string' && src.userId
        ? src.userId
        : typeof src.playerId === 'string' && src.playerId
          ? src.playerId
          : undefined;
  if (!id) return null;
  return {
    id,
    username: String(src.username ?? src.name ?? '玩家'),
    avatarId: src.avatarId ?? src.avatar,
    score: Number(src.score ?? src.points ?? 0) || 0,
  };
}

export default function Room() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { toasts, push, dismiss } = useToasts();

  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [totalRounds, setTotalRounds] = useState<number | null>(null);
  const [roundScores, setRoundScores] = useState<RoundScore[]>([]);
  const [lastWord, setLastWord] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [color, setColor] = useState(PALETTE[0].hex);
  const [bursts, setBursts] = useState<number[]>([]);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const boardRef = useRef<DrawBoardHandle | null>(null);
  const playersRef = useRef<RoomPlayer[]>([]);
  const myIdRef = useRef<string | undefined>(undefined);
  const userRef = useRef(user);
  const echoesRef = useRef<EchoEntry[]>([]);
  const phaseRef = useRef<Phase>('waiting');

  playersRef.current = roomState?.players ?? [];
  userRef.current = user;
  phaseRef.current = phase;

  const myId = useMemo(() => {
    if (user?.id) {
      // 优先与房间内玩家 id 对齐（防止本地 id 为空）
      const hit = roomState?.players.find((p) => p.id === user.id);
      if (hit) return hit.id;
      return user.id || undefined;
    }
    const byName = roomState?.players.find((p) => p.username === user?.username);
    return byName?.id;
  }, [user, roomState]);
  myIdRef.current = myId;

  const isHost = !!myId && !!roomState?.hostId && roomState.hostId === myId;
  const isDrawer = phase === 'playing' && !!round && !!myId && round.drawerId === myId;

  const nameOf = useCallback((playerId: string): string => {
    if (playerId && playerId === myIdRef.current) return userRef.current?.username ?? '你';
    const p = playersRef.current.find((x) => x.id === playerId);
    return p?.username ?? '玩家';
  }, []);

  const addSystemLine = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: ++msgSeq, kind: 'system', text }]);
  }, []);

  const removeBurst = useCallback((id: number) => {
    setBursts((list) => list.filter((b) => b !== id));
  }, []);

  /* ---------- 连接 /game 空间（握手带 JWT） ---------- */
  useEffect(() => {
    if (!token || !code) return;
    const s = io('/game', { auth: { token }, reconnection: true });
    socketRef.current = s;

    const onConnect = () => {
      setConnected(true);
      s.emit('room:join', { code });
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => push(`连接失败：${err.message}`);
    const onError = (data: unknown) => push(errorMessage(data));

    const onState = (data: unknown) => {
      const st = normalizeRoomState(data);
      setRoomState((prev) =>
        prev
          ? {
              ...prev,
              ...st,
              players: st.players.length > 0 ? st.players : prev.players,
              hostId: st.hostId ?? prev.hostId,
              totalRounds: st.totalRounds ?? prev.totalRounds,
            }
          : st,
      );
      if (st.totalRounds) setTotalRounds(st.totalRounds);
      if (st.status === 'playing' || st.status === 'in_progress') {
        setPhase((p) => (p === 'waiting' ? 'playing' : p));
      }
    };

    const onPlayerJoined = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      if (Array.isArray(o.players)) {
        setRoomState((prev) => (prev ? { ...prev, players: normalizeRoomState({ players: o.players }).players } : prev));
        return;
      }
      const p = extractPlayer(data);
      if (!p) return;
      setRoomState((prev) => {
        if (!prev) return prev;
        if (prev.players.some((x) => x.id === p.id)) return prev;
        return { ...prev, players: [...prev.players, p] };
      });
    };

    const onPlayerLeft = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      if (Array.isArray(o.players)) {
        setRoomState((prev) => (prev ? { ...prev, players: normalizeRoomState({ players: o.players }).players } : prev));
        return;
      }
      const id =
        typeof o.playerId === 'string'
          ? o.playerId
          : typeof o.id === 'string'
            ? o.id
            : typeof (o.player as Record<string, any> | undefined)?.id === 'string'
              ? (o.player as Record<string, any>).id
              : '';
      if (!id) return;
      setRoomState((prev) =>
        prev ? { ...prev, players: prev.players.filter((p) => p.id !== id) } : prev,
      );
    };

    const onGameStarted = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      const n = Number(o.totalRounds ?? o.rounds);
      if (Number.isFinite(n) && n > 0) setTotalRounds(n);
      setRound(null);
      setRoundScores([]);
      setResults([]);
      setRemaining(null);
      setPhase('playing');
    };

    const onRoundStart = (data: unknown) => {
      const info = normalizeRoundStart(data);
      setRound(info);
      setPhase('playing');
      setRoundScores([]);
      setRemaining(
        info.endsAt ? Math.max(0, Math.round((info.endsAt - Date.now()) / 1000)) : null,
      );
    };

    const onStroke = (data: unknown) => {
      const s2 = normalizeStroke(data);
      if (s2) boardRef.current?.applyStroke(s2);
    };

    const onCleared = () => boardRef.current?.clear();

    const onGuessCorrect = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      const playerId = String(o.playerId ?? o.userId ?? '');
      const gained = Number(o.gained ?? o.score ?? 0) || 0;
      addSystemLine(`🎉 ${nameOf(playerId)} 猜中了！+${gained} 分`);
      const id = ++burstSeq;
      setBursts((list) => [...list, id]);
    };

    const onChat = (data: unknown) => {
      const msg = normalizeChat(data);
      if (!msg) return;
      if (msg.kind === 'player' && msg.playerId && msg.playerId === myIdRef.current) {
        const now = Date.now();
        const hit = echoesRef.current.findIndex(
          (e) => e.text === msg.text && now - e.at < 6000,
        );
        if (hit >= 0) {
          echoesRef.current.splice(hit, 1);
          return;
        }
      }
      setMessages((prev) => [...prev, msg]);
    };

    const onRoundEnd = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      setRoundScores(normalizeScores(o.scores ?? data));
      setLastWord(typeof o.word === 'string' ? o.word : '');
      setPhase('roundEnd');
      setRemaining(null);
    };

    const onGameEnd = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      setResults(normalizeResults(o.results ?? data));
      setPhase('gameEnd');
      setRemaining(null);
    };

    const onTimer = (data: unknown) => {
      const v = normalizeTimer(data);
      if (v != null) setRemaining(v);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('error', onError);
    s.on('room:state', onState);
    s.on('player:joined', onPlayerJoined);
    s.on('player:left', onPlayerLeft);
    s.on('game:started', onGameStarted);
    s.on('round:start', onRoundStart);
    s.on('stroke', onStroke);
    s.on('tool:cleared', onCleared);
    s.on('guess:correct', onGuessCorrect);
    s.on('chat', onChat);
    s.on('round:end', onRoundEnd);
    s.on('game:end', onGameEnd);
    s.on('timer', onTimer);

    return () => {
      s.emit('room:leave');
      s.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token, code, push, addSystemLine, nameOf]);

  /* ---------- 房间快照（刷新恢复，尽力而为） ---------- */
  useEffect(() => {
    if (!code) return;
    let alive = true;
    api<unknown>(`/rooms/${encodeURIComponent(code)}`)
      .then((data) => {
        if (!alive) return;
        const st = normalizeRoomState(data);
        if (st.players.length > 0 || st.hostId) {
          setRoomState((prev) => prev ?? st);
          if (st.totalRounds) setTotalRounds(st.totalRounds);
          if (st.status === 'playing' || st.status === 'in_progress') setPhase('playing');
        }
      })
      .catch(() => {
        /* 快照非必需，socket 会兜底 */
      });
    return () => {
      alive = false;
    };
  }, [code]);

  /* ---------- 倒计时（timer 事件驱动，事件间隙本地递减） ---------- */
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = window.setInterval(() => {
      setRemaining((r) => (r == null ? r : Math.max(0, r - 1)));
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  /* ---------- 发送 ---------- */

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const handleStroke = useCallback(
    (s: StrokeEvent) => {
      emit('stroke', s);
    },
    [emit],
  );

  const handleClear = useCallback(() => {
    boardRef.current?.clear();
    emit('tool:clear');
  }, [emit]);

  const handleSend = useCallback(
    (text: string, kind: 'guess' | 'chat') => {
      if (!socketRef.current) {
        push('尚未连接服务器，请稍候');
        return;
      }
      emit(kind, { text });
      echoesRef.current.push({ text, at: Date.now() });
      setMessages((prev) => [
        ...prev,
        {
          id: ++msgSeq,
          kind: 'player',
          playerId: myIdRef.current,
          username: userRef.current?.username ?? '我',
          text,
        },
      ]);
    },
    [emit, push],
  );

  const startGame = useCallback(() => emit('game:start'), [emit]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      push('复制失败，请手动复制房间码');
    }
  }

  const roundNo = round?.roundNo ?? roomState?.roundNo ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-5">
      <ToastStack toasts={toasts} dismiss={dismiss} />
      {bursts.map((id) => (
        <PetalBurst key={id} id={id} onDone={removeBurst} />
      ))}

      {/* 顶栏 */}
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" className="px-4 py-2 text-sm" onClick={() => navigate('/lobby')}>
          ← 大厅
        </Button>
        <button
          onClick={copyCode}
          className="rounded-full bg-white px-4 py-2 font-mono text-sm font-bold tracking-widest text-stella shadow-sm transition hover:shadow"
          title="点击复制房间码"
        >
          房间 {code || '----'} <span className="text-xs font-sans text-ink/40">{copied ? '已复制✓' : '复制'}</span>
        </button>
        <div className="rounded-full bg-white px-4 py-2 font-display text-sm shadow-sm">
          回合 {roundNo || '–'}/{totalRounds ?? '–'}
        </div>
        {phase === 'playing' && remaining != null && (
          <div
            className={`rounded-full px-4 py-2 font-display text-sm shadow-sm ${
              remaining <= 10 ? 'bg-sakura text-white animate-pulse' : 'bg-mint/15 text-mint'
            }`}
          >
            ⏱ {remaining}s
          </div>
        )}
        <div
          className={`ml-auto rounded-full px-3 py-1.5 text-xs font-semibold ${
            connected ? 'bg-mint/15 text-mint' : 'bg-sakura/10 text-sakura'
          }`}
        >
          {connected ? '● 已连接' : '○ 连接中…'}
        </div>
      </header>

      {/* 三栏：左玩家 / 中画板 / 右聊天 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        <div className="order-2 lg:order-1">
          <PlayerList
            players={roomState?.players ?? []}
            hostId={roomState?.hostId}
            drawerId={round?.drawerId}
            myId={myId}
          />
        </div>

        <div className="relative order-1 space-y-3 lg:order-2">
          {/* 工具条：6 色调色板 + 清空（仅画者可见） */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/90 p-2.5 shadow-[0_8px_24px_-16px_rgba(46,38,69,0.4)]">
            <span className="px-1 text-xs font-bold text-ink/45">画笔</span>
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                aria-label={`颜色 ${c.name}`}
                onClick={() => setColor(c.hex)}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  color === c.hex
                    ? 'scale-110 border-ink/60 ring-2 ring-sakura/50'
                    : 'border-black/10 hover:scale-105'
                }`}
                style={{ background: c.hex }}
              />
            ))}
            {isDrawer && (
              <Button variant="ghost" className="ml-auto px-3 py-1.5 text-sm" onClick={handleClear}>
                🧹 清空
              </Button>
            )}
          </div>

          <div className="relative">
            <DrawBoard ref={boardRef} enabled={isDrawer} color={color} onStroke={handleStroke} />

            {/* 回合开始揭示卡（标志性瞬间 ②） */}
            {phase === 'playing' && round && (
              <RevealCard
                key={`${round.roundNo}-${round.drawerId}`}
                round={round}
                isDrawer={isDrawer}
              />
            )}

            {/* 回合结算 */}
            {phase === 'roundEnd' && (
              <div className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-ink/45 p-4 backdrop-blur-sm">
                <Card className="gd-pop w-full max-w-sm p-5 text-center">
                  <h3 className="font-display text-2xl text-stella">本回合结束！</h3>
                  <p className="mt-2 text-xs text-ink/50">题目是</p>
                  <p className="font-display text-3xl break-all text-sakura">{lastWord || '—'}</p>
                  <ul className="gd-scroll mt-3 max-h-44 space-y-1 overflow-y-auto text-left">
                    {roundScores.length === 0 && (
                      <li className="text-center text-sm text-ink/45">本回合无人猜中</li>
                    )}
                    {roundScores.map((s, i) => (
                      <li
                        key={`${s.playerId}-${i}`}
                        className="flex items-center justify-between rounded-xl bg-bg px-3 py-1.5 text-sm"
                      >
                        <span className="truncate font-semibold">{nameOf(s.playerId)}</span>
                        <span className="font-display text-mint">+{s.gained}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ink/45">下一回合即将开始…</p>
                </Card>
              </div>
            )}
          </div>

          {/* 状态条 / 回合提示 */}
          {phase === 'waiting' && (
            <Card className="flex flex-wrap items-center justify-center gap-3 px-4 py-3 text-center">
              <span className="text-sm text-ink/60">
                {isHost ? '玩家到齐后，点击开始游戏！' : '等待房主开始游戏…'}
              </span>
              {isHost && (
                <Button onClick={startGame} className="px-6">
                  ▶ 开始游戏
                </Button>
              )}
            </Card>
          )}
          {phase === 'playing' && round && (
            <Card className="flex flex-wrap items-center justify-center gap-2 px-4 py-2.5 text-center text-sm">
              {isDrawer ? (
                <>
                  <span className="text-ink/50">你的题目：</span>
                  <span className="font-display text-lg text-sakura break-all">
                    {round.word ?? '—'}
                  </span>
                  {round.category && (
                    <span className="rounded-full bg-stella/10 px-2 py-0.5 text-xs text-stella">
                      {round.category}
                    </span>
                  )}
                  <span className="text-ink/40">画出来让大家猜！</span>
                </>
              ) : (
                <>
                  <span className="text-ink/50">字数提示：</span>
                  <span className="font-display text-lg text-stella">{round.charCount} 字</span>
                  <span className="text-ink/40">在右侧输入完整词语猜题</span>
                </>
              )}
            </Card>
          )}
          {phase === 'roundEnd' && (
            <p className="text-center text-sm text-ink/50">公布得分中，等待下一回合…</p>
          )}
        </div>

        <div className="order-3 flex flex-col">
          <ChatPanel messages={messages} myId={myId} onSend={handleSend} />
        </div>
      </div>

      {/* 对局结算 */}
      {phase === 'gameEnd' && (
        <div className="fixed inset-0 z-[55] grid place-items-center bg-ink/55 p-4 backdrop-blur-sm">
          <Card className="gd-pop w-full max-w-md p-7 text-center">
            <span className="text-3xl">🎉</span>
            <h2 className="font-display text-4xl text-sakura">对局结束！</h2>
            <p className="mt-1 text-sm text-ink/55">最终排名</p>
            <ol className="mt-4 space-y-2">
              {results.length === 0 && (
                <li className="py-4 text-sm text-ink/45">暂无排名数据</li>
              )}
              {results.map((r) => (
                <li
                  key={`${r.rank}-${r.username}`}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left ${
                    r.rank === 1 ? 'bg-star/15 ring-2 ring-star/60' : 'bg-bg'
                  }`}
                >
                  <span className="w-8 text-center text-xl">
                    {MEDALS[r.rank - 1] ?? `#${r.rank}`}
                  </span>
                  <Avatar user={{ username: r.username, avatarId: r.playerId }} size={34} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.username}</span>
                  <span className="font-display text-lg text-stella">{r.score} 分</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={() => navigate('/lobby')}>返回大厅</Button>
              <Button variant="ghost" onClick={() => navigate('/leaderboard')}>
                查看排行
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
