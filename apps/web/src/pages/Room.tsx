import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { ChatPanel } from '../components/game/ChatPanel';
import { ChainStage } from '../components/game/ChainStage';
import type { VoteResultData } from '../components/game/ChainStage';
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
  normalizeChainEnd,
  normalizeChat,
  normalizeResults,
  normalizeRoomState,
  normalizeRoundStart,
  normalizeScores,
  normalizeStroke,
  normalizeTimer,
  normalizeVoteCounts,
  normalizeWordTrail,
  nextMsgId,
} from '../lib/types';
import type {
  ChainEndData,
  ChatMsg,
  ResultRow,
  RoomPlayer,
  RoomState,
  RoundInfo,
  RoundScore,
  StrokeEvent,
} from '../lib/types';

type Phase = 'waiting' | 'playing' | 'roundEnd' | 'chainEnd' | 'gameEnd';

const PALETTE = [
  { name: '樱粉', hex: '#ff6fa5' },
  { name: '星紫', hex: '#7b6cf6' },
  { name: '墨', hex: '#2e2645' },
  { name: '薄荷', hex: '#3ecfa0' },
  { name: '白', hex: '#ffffff' },
  { name: '黄', hex: '#ffd93d' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

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
  const [lastPassedText, setLastPassedText] = useState('');
  const [lastWordTrail, setLastWordTrail] = useState<string[]>([]);
  const [chainEnd, setChainEnd] = useState<ChainEndData | null>(null);
  const [myVote, setMyVote] = useState<1 | 2 | 3 | null>(null);
  const [voteResult, setVoteResult] = useState<VoteResultData | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [color, setColor] = useState(PALETTE[0].hex);
  const [bursts, setBursts] = useState<number[]>([]);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const boardRef = useRef<DrawBoardHandle | null>(null);
  /** 仅用户主动离房时置位；刷新/关页不发 room:leave，由服务端断线保留玩家与分数 */
  const leaveIntentRef = useRef(false);
  const playersRef = useRef<RoomPlayer[]>([]);
  const myIdRef = useRef<string | undefined>(undefined);
  const userRef = useRef(user);
  const echoesRef = useRef<EchoEntry[]>([]);
  const phaseRef = useRef<Phase>('waiting');
  const roundKeyRef = useRef('');
  const chainEndRef = useRef<ChainEndData | null>(null);
  const voteCastRef = useRef<1 | 2 | 3 | null>(null);

  playersRef.current = roomState?.players ?? [];
  userRef.current = user;
  phaseRef.current = phase;
  chainEndRef.current = chainEnd;

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
  const isChain = roomState?.drawRule === 'chain';
  const isGuesser = isChain && !!myId && !!roomState?.guesserId && roomState.guesserId === myId;
  const hasCategory = !!(round?.category || roomState?.promptCategory);
  /** 链式传题段（非词库原词）：不显示类别、加「上一棒的传题」前缀 */
  const passedPrompt = isChain && ((roomState?.chainIndex ?? 0) > 0 || !hasCategory);

  const nameOf = useCallback((playerId: string): string => {
    if (playerId && playerId === myIdRef.current) return userRef.current?.username ?? '你';
    const p = playersRef.current.find((x) => x.id === playerId);
    return p?.username ?? '玩家';
  }, []);

  const removeBurst = useCallback((id: number) => {
    setBursts((list) => list.filter((b) => b !== id));
  }, []);

  /**
   * 应用完整房间快照（socket room:state 与 REST /rooms/:code 共用）：
   * 更新玩家 → 回放快照笔迹（后端无单独 replay 事件）→ 恢复当前回合/对局状态。
   */
  const applyState = useCallback((raw: unknown) => {
    const st = normalizeRoomState(raw);
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

    const clearChainStage = () => {
      chainEndRef.current = null;
      voteCastRef.current = null;
      setChainEnd(null);
      setMyVote(null);
      setVoteResult(null);
    };

    // 链回放/投票进行中：仅下一条链的新回合（roundNo 变化）或对局结束才退出舞台
    if (phaseRef.current === 'chainEnd') {
      if (st.status === 'finished') {
        roundKeyRef.current = '';
        clearChainStage();
        setPhase('gameEnd');
        setRemaining(null);
        return;
      }
      const cd = chainEndRef.current;
      const sameRound = !!cd && st.roundNo != null && st.roundNo === cd.roundNo;
      if (!(st.status === 'playing' && st.drawerId && !sameRound)) {
        // 仍是本条链的状态（重连快照等）：只同步玩家/回合数，不打断舞台、不刷画布
        return;
      }
      clearChainStage();
    }

    const board = boardRef.current;
    if (board) {
      board.clear();
      for (const s of st.strokes) board.applyStroke(s);
    }

    if (st.status === 'finished') {
      roundKeyRef.current = '';
      clearChainStage();
      setPhase('gameEnd');
      setRemaining(null);
      return;
    }
    if (st.drawerId && st.status === 'playing') {
      roundKeyRef.current = `${st.roundNo ?? 0}:${st.drawerId}`;
      setRound({
        roundNo: st.roundNo ?? 0,
        drawerId: st.drawerId,
        word: st.word,
        charCount: st.charCount ?? 0,
        endsAt: st.endsAt,
      });
      setPhase('playing');
      setRemaining(st.endsAt ? Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)) : null);
    } else if (st.status === 'playing') {
      setPhase((p) => (p === 'waiting' ? 'playing' : p));
    }
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

    const onState = (data: unknown) => applyState(data);

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
      // 后端 player:left = { userId, username, reason }
      const id =
        typeof o.userId === 'string'
          ? o.userId
          : typeof o.playerId === 'string'
            ? o.playerId
            : typeof o.id === 'string'
              ? o.id
              : typeof (o.player as Record<string, any> | undefined)?.id === 'string'
                ? (o.player as Record<string, any>).id
                : '';
      if (!id) return;
      setRoomState((prev) => {
        if (!prev) return prev;
        const players = prev.players.filter((p) => p.id !== id);
        // 房主离开时服务端转移给 players[0]，前端同步推断
        const hostId = prev.hostId === id ? players[0]?.id : prev.hostId;
        return { ...prev, players, hostId };
      });
    };

    const onGameStarted = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      const n = Number(o.totalRounds ?? o.rounds);
      if (Number.isFinite(n) && n > 0) setTotalRounds(n);
      roundKeyRef.current = '';
      chainEndRef.current = null;
      voteCastRef.current = null;
      setChainEnd(null);
      setMyVote(null);
      setVoteResult(null);
      setRound(null);
      setRoundScores([]);
      setResults([]);
      setRemaining(null);
      setPhase('playing');
    };

    const onRoundStart = (data: unknown) => {
      const info = normalizeRoundStart(data);
      const key = `${info.roundNo}:${info.drawerId}`;
      if (key !== roundKeyRef.current) {
        // 新回合：服务端仅清 strokes 数组不广播清空事件，前端在换回合时清画布
        roundKeyRef.current = key;
        boardRef.current?.clear();
      }
      // 新回合（含下一条链开局）：退出链舞台，清空上一段传导内容
      chainEndRef.current = null;
      voteCastRef.current = null;
      setChainEnd(null);
      setMyVote(null);
      setVoteResult(null);
      setLastPassedText('');
      setLastWordTrail([]);
      // 链式态字段随 round:start 下发时同步进房间状态
      const o = (data ?? {}) as Record<string, any>;
      const patch: Partial<RoomState> = {};
      if (typeof o.guesserId === 'string' && o.guesserId) patch.guesserId = o.guesserId;
      if (typeof o.prompt === 'string' && o.prompt) patch.prompt = o.prompt;
      if (typeof o.promptCategory === 'string') patch.promptCategory = o.promptCategory || undefined;
      if (o.drawRule === 'chain' || o.drawRule === 'classic') patch.drawRule = o.drawRule;
      if (o.chainIndex != null && Number.isFinite(Number(o.chainIndex))) patch.chainIndex = Number(o.chainIndex);
      if (o.chainTotal != null && Number.isFinite(Number(o.chainTotal))) patch.chainTotal = Number(o.chainTotal);
      if (Object.keys(patch).length > 0) {
        setRoomState((prev) => (prev ? { ...prev, ...patch } : prev));
      }
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
      // 文字提示由后端 systemChat 广播（chat 系统行），此处：花瓣 + 分数乐观更新
      const o = (data ?? {}) as Record<string, any>;
      const playerId = typeof o.playerId === 'string' ? o.playerId : '';
      const gained = Number(o.gained ?? 0) || 0;
      if (playerId && gained > 0) {
        setRoomState((prev) =>
          prev
            ? {
                ...prev,
                players: prev.players.map((p) =>
                  p.id === playerId ? { ...p, score: p.score + gained } : p,
                ),
              }
            : prev,
        );
      }
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
      const scores = normalizeScores(o.scores ?? data);
      setRoundScores(scores);
      setLastWord(typeof o.word === 'string' ? o.word : '');
      // 链式：本段传导内容（round:end 带出）
      setLastPassedText(typeof o.passedText === 'string' ? o.passedText : '');
      setLastWordTrail(normalizeWordTrail(o.wordTrail));
      // 回合结束公布 total → 精确刷新玩家列表分数（画者抽成等服务端已计入）
      const totals = new Map(scores.filter((s) => s.total != null).map((s) => [s.playerId, s.total as number]));
      if (totals.size > 0) {
        setRoomState((prev) =>
          prev
            ? {
                ...prev,
                players: prev.players.map((p) =>
                  totals.has(p.id) ? { ...p, score: totals.get(p.id) ?? p.score } : p,
                ),
              }
            : prev,
        );
      }
      setPhase('roundEnd');
      setRemaining(null);
    };

    const onGameEnd = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      setResults(normalizeResults(o.results ?? data));
      chainEndRef.current = null;
      voteCastRef.current = null;
      setChainEnd(null);
      setMyVote(null);
      setVoteResult(null);
      setPhase('gameEnd');
      setRemaining(null);
    };

    /** chain:end { segments, wordTrail, replay } → 进入链回放 + 投票 */
    const onChainEnd = (data: unknown) => {
      const parsed = normalizeChainEnd(data);
      chainEndRef.current = parsed;
      voteCastRef.current = null;
      setChainEnd(parsed);
      setMyVote(null);
      setVoteResult(null);
      setRemaining(null);
      setPhase('chainEnd');
    };

    /** vote:result { counts, wordTrail } */
    const onVoteResult = (data: unknown) => {
      const o = (data ?? {}) as Record<string, any>;
      setVoteResult({
        counts: normalizeVoteCounts(o.counts ?? o.votes ?? data),
        wordTrail: normalizeWordTrail(o.wordTrail),
      });
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
    s.on('chain:end', onChainEnd);
    s.on('vote:result', onVoteResult);
    s.on('game:end', onGameEnd);
    s.on('timer', onTimer);

    return () => {
      if (leaveIntentRef.current) {
        s.emit('room:leave');
      }
      s.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token, code, push, applyState]);

  /* ---------- 房间快照（刷新恢复，尽力而为；与 socket room:state 幂等） ---------- */
  useEffect(() => {
    if (!code) return;
    let alive = true;
    api<unknown>(`/rooms/${encodeURIComponent(code)}`)
      .then((data) => {
        if (alive) applyState(data);
      })
      .catch(() => {
        /* 快照非必需，socket 会兜底 */
      });
    return () => {
      alive = false;
    };
  }, [code, applyState]);

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
          id: nextMsgId(),
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

  /** 链完成投票（每人一次）：vote:cast { choice } */
  const castVote = useCallback(
    (choice: 1 | 2 | 3) => {
      if (voteCastRef.current != null) return;
      voteCastRef.current = choice;
      setMyVote(choice);
      emit('vote:cast', { choice });
    },
    [emit],
  );

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
        <Button
          variant="ghost"
          className="px-4 py-2 text-sm"
          onClick={() => {
            leaveIntentRef.current = true;
            navigate('/lobby');
          }}
        >
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
                  {lastPassedText && (
                    <p className="mt-2 rounded-xl bg-stella/10 px-3 py-1.5 text-xs font-bold break-all text-stella">
                      🔗 传给下一棒：{lastPassedText}
                    </p>
                  )}
                  {lastWordTrail.length > 0 && (
                    <div className="mt-2 rounded-xl bg-bg px-3 py-2 text-left">
                      <p className="text-[11px] font-bold text-ink/50">词语演化链</p>
                      <p className="mt-0.5 text-xs break-all text-ink/70">
                        {lastWordTrail.join(' → ')}
                      </p>
                    </div>
                  )}
                  <ul className="gd-scroll mt-3 max-h-44 space-y-1 overflow-y-auto text-left">
                    {roundScores.length === 0 && (
                      <li className="text-center text-sm text-ink/45">本回合无人猜中</li>
                    )}
                    {roundScores.map((s, i) => (
                      <li
                        key={`${s.playerId}-${i}`}
                        className="flex items-center justify-between rounded-xl bg-bg px-3 py-1.5 text-sm"
                      >
                        <span className="truncate font-semibold">
                          {s.username ?? nameOf(s.playerId)}
                        </span>
                        <span className="shrink-0">
                          <span className="font-display text-mint">+{s.gained}</span>
                          {s.total != null && (
                            <span className="ml-2 text-xs text-ink/40">总 {s.total}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ink/45">下一回合即将开始…</p>
                </Card>
              </div>
            )}

            {/* 链完成：回放播放器 + 三档投票卡 */}
            {phase === 'chainEnd' && chainEnd && (
              <ChainStage
                boardRef={boardRef}
                data={chainEnd}
                myVote={myVote}
                voteResult={voteResult}
                onVote={castVote}
              />
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
                  {passedPrompt && (
                    <span className="rounded-full bg-stella/15 px-2.5 py-0.5 text-xs font-bold text-stella">
                      🔗 上一棒的传题
                    </span>
                  )}
                  <span className="text-ink/50">你的题目：</span>
                  <span className="font-display text-lg text-sakura break-all">
                    {round.word ?? roomState?.prompt ?? '—'}
                  </span>
                  {hasCategory && (
                    <span className="rounded-full bg-stella/10 px-2 py-0.5 text-xs text-stella">
                      {round.category ?? roomState?.promptCategory}
                    </span>
                  )}
                  <span className="text-ink/40">画出来让大家猜！</span>
                </>
              ) : isChain ? (
                isGuesser ? (
                  <>
                    <span className="text-ink/50">字数提示：</span>
                    <span className="font-display text-lg text-stella">{round.charCount} 字</span>
                    <span className="rounded-full bg-sakura/15 px-2.5 py-0.5 text-xs font-bold text-sakura">
                      🎯 你来猜 · 答案会传给下一棒
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-ink/50">本回合由指定玩家猜词</span>
                    <span className="text-ink/40">围观作画，右侧闲聊吧</span>
                  </>
                )
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
          {phase === 'chainEnd' && (
            <p className="text-center text-sm text-ink/50">本条链已完成，回放与投票进行中…</p>
          )}
        </div>

        <div className="order-3 flex flex-col">
          <ChatPanel
            messages={messages}
            myId={myId}
            onSend={handleSend}
            canGuess={!isChain || isGuesser}
            chainHint={isChain && isGuesser ? '你来猜（答案会传给下一棒）' : undefined}
          />
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
                  <Avatar user={{ username: r.username, avatarId: r.avatarId }} size={34} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.username}</span>
                  <span className="font-display text-lg text-stella">{r.score} 分</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex justify-center gap-3">
              <Button
                onClick={() => {
                  leaveIntentRef.current = true;
                  navigate('/lobby');
                }}
              >
                返回大厅
              </Button>
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
