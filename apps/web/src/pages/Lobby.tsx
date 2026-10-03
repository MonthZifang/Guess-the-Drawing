import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { Button, Card, Input, Avatar } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface CreateRoomResp {
  code: string;
}

type OrderRule = 'id' | 'lapShuffle' | 'roundShuffle';
type DrawRule = 'classic' | 'chain';
type RoundMode = 'byPlayers' | 'fixed' | 'custom';

const ORDER_RULES: readonly { id: OrderRule; label: string; desc: string }[] = [
  { id: 'id', label: '顺序模式', desc: '按玩家顺序轮流' },
  { id: 'lapShuffle', label: '随机模式', desc: '每圈开始洗牌' },
  { id: 'roundShuffle', label: '混乱模式', desc: '每回合重洗未画者' },
];

const DRAW_RULES: readonly { id: DrawRule; label: string; desc: string }[] = [
  { id: 'classic', label: '词库经典', desc: '全员抢猜词库词' },
  { id: 'chain', label: '链式接龙', desc: '猜的词传给下一棒' },
];

const ROUND_MODES: readonly { id: RoundMode; label: string; desc: string }[] = [
  { id: 'byPlayers', label: '按人数', desc: '开局人数 = 总回合' },
  { id: 'fixed', label: '固定', desc: '固定 6 回合' },
  { id: 'custom', label: '自定义', desc: '1–60 回合' },
];

function SegOptions<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string; desc: string }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-xl border-2 px-2 py-2 text-center transition ${
            value === o.id
              ? 'border-sakura bg-sakura/10 shadow-sm'
              : 'border-ink/10 bg-white hover:border-sakura/40'
          }`}
        >
          <span className="block text-sm font-bold text-ink">{o.label}</span>
          <span className="block text-[11px] text-ink/50">{o.desc}</span>
        </button>
      ))}
    </div>
  );
}

export default function Lobby() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [orderRule, setOrderRule] = useState<OrderRule>('id');
  const [drawRule, setDrawRule] = useState<DrawRule>('classic');
  const [roundMode, setRoundMode] = useState<RoundMode>('byPlayers');
  const [customRounds, setCustomRounds] = useState(6);
  const [createdCode, setCreatedCode] = useState('');
  const [copied, setCopied] = useState(false);

  async function createRoom() {
    setError('');
    if (roundMode === 'custom' && (!Number.isFinite(customRounds) || customRounds < 1 || customRounds > 60)) {
      setError('自定义回合数需为 1–60 的数字');
      return;
    }
    setBusy(true);
    try {
      const res = await api<CreateRoomResp>('/rooms', {
        method: 'POST',
        body: {
          orderRule,
          drawRule,
          rounds:
            roundMode === 'custom'
              ? { mode: 'custom', value: Math.round(customRounds) }
              : { mode: roundMode },
        },
      });
      if (!res?.code) throw new Error('创建房间失败：服务未返回房间码');
      setCreatedCode(String(res.code).toUpperCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(createdCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('复制失败，请手动复制邀请码');
    }
  }

  function joinRoom(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError('请输入房间码');
      return;
    }
    navigate(`/room/${encodeURIComponent(code)}`);
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Card className="mb-6 flex items-center gap-4 p-6 gd-pop">
          <Avatar user={user} size={64} />
          <div>
            <h1 className="font-display text-3xl">{user?.username ?? '旅行者'}，欢迎回来！</h1>
            <p className="mt-1 text-sm text-ink/55">配置规则创建房间，或输入房间码加入对局。</p>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-6">
            <h2 className="font-display text-2xl text-sakura">创建房间</h2>
            <p className="mt-2 text-sm text-ink/55">
              你将成为房主，邀请好友输入 6 位邀请码加入，人数齐后点「开始游戏」。
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink/70">画者顺序</span>
                <SegOptions value={orderRule} onChange={setOrderRule} options={ORDER_RULES} />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink/70">画板规则</span>
                <SegOptions value={drawRule} onChange={setDrawRule} options={DRAW_RULES} />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink/70">回合设置</span>
                <SegOptions value={roundMode} onChange={setRoundMode} options={ROUND_MODES} />
                {roundMode === 'custom' && (
                  <label className="mt-2 flex items-center gap-2 text-sm text-ink/70">
                    <span>回合数</span>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={customRounds}
                      onChange={(e) => setCustomRounds(Number(e.target.value))}
                      className="w-24 px-3 py-1.5"
                    />
                    <span className="text-xs text-ink/45">1–60</span>
                  </label>
                )}
              </div>
            </div>

            <Button className="mt-5 w-full py-3" onClick={createRoom} disabled={busy}>
              {busy ? '创建中…' : '✨ 创建新房间'}
            </Button>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-2xl text-stella">加入房间</h2>
            <form onSubmit={joinRoom} className="mt-3 flex gap-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="输入房间码，如 AB12"
                maxLength={8}
                className="font-mono tracking-widest"
              />
              <Button variant="stella" type="submit" className="shrink-0">
                加入
              </Button>
            </form>
            <p className="mt-3 text-sm text-ink/55">房间码由房主在房间页顶部分享给你。</p>
          </Card>
        </div>

        {error && (
          <p className="gd-shake mt-4 rounded-2xl bg-sakura/10 px-4 py-3 text-sm text-sakura">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="ghost" onClick={() => navigate('/history')}>
            🕘 对局历史
          </Button>
          <Button variant="ghost" onClick={() => navigate('/leaderboard')}>
            🏆 排行榜
          </Button>
          <Button variant="ghost" onClick={() => { signOut(); navigate('/login'); }}>
            退出登录
          </Button>
        </div>
      </main>

      {/* 创建成功：展示 6 位邀请码 */}
      {createdCode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-4 backdrop-blur-sm">
          <Card className="gd-pop w-full max-w-sm p-7 text-center">
            <span className="text-3xl">🎉</span>
            <h3 className="mt-1 font-display text-2xl text-sakura">房间创建成功！</h3>
            <p className="mt-1 text-xs text-ink/50">6 位邀请码，分享给好友即可加入</p>
            <p className="mt-4 rounded-2xl bg-bg px-4 py-4 font-mono text-4xl font-bold tracking-[0.35em] text-stella">
              {createdCode}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Button onClick={() => navigate(`/room/${createdCode}`)}>进入房间 →</Button>
              <Button variant="ghost" onClick={copyInvite}>
                {copied ? '已复制✓' : '复制邀请码'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
