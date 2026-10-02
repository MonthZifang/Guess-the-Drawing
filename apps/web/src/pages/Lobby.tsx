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

export default function Lobby() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function createRoom() {
    setError('');
    setBusy(true);
    try {
      const res = await api<CreateRoomResp>('/rooms', { method: 'POST', body: {} });
      if (!res?.code) throw new Error('创建房间失败：服务未返回房间码');
      navigate(`/room/${String(res.code).toUpperCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      setBusy(false);
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
            <p className="mt-1 text-sm text-ink/55">创建房间叫上朋友，或输入房间码加入对局。</p>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-6">
            <h2 className="font-display text-2xl text-sakura">创建房间</h2>
            <p className="mt-2 text-sm text-ink/55">
              你将成为房主，邀请好友输入房间码加入，人数齐后点「开始游戏」。
            </p>
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
    </div>
  );
}
