import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { AuthResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';
import { AVATAR_COUNT, Button, Card, Input, PageTitle, avatarSrc } from './ui';

interface Props {
  mode: 'login' | 'register';
}

export function AuthForm({ mode }: Props) {
  const isRegister = mode === 'register';
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatarId, setAvatarId] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setBusy(true);
    try {
      const body = isRegister
        ? { username: username.trim(), password, avatarId }
        : { username: username.trim(), password };
      const res = await api<AuthResponse>(isRegister ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body,
      });
      const user: User = {
        id: String(res.user?.id ?? ''),
        username: res.user?.username ?? username.trim(),
        avatarId: res.user?.avatarId ?? (isRegister ? avatarId : undefined),
      };
      signIn(res.accessToken, user);
      navigate('/lobby', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 gd-pop">
        <div className="mb-6 text-center">
          <PageTitle>{isRegister ? '创建账号' : '欢迎回来'}</PageTitle>
          <p className="mt-1 text-sm text-ink/50">
            {isRegister ? '选好头像，一起画画猜词吧！' : '登录后进入大厅开一局'}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">用户名</span>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="2–16 位字符"
              maxLength={16}
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">密码</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </label>

          {isRegister && (
            <div>
              <span className="mb-2 block text-sm font-semibold text-ink/70">选择头像</span>
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAvatarId(n)}
                    aria-label={`头像 ${n}`}
                    className={`aspect-square overflow-hidden rounded-full transition ${
                      avatarId === n
                        ? 'scale-110 ring-[3px] ring-sakura ring-offset-2 ring-offset-white'
                        : 'opacity-70 ring-2 ring-transparent hover:opacity-100 hover:ring-stella/40'
                    }`}
                  >
                    <img src={avatarSrc(n)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="gd-shake rounded-xl bg-sakura/10 px-3 py-2 text-sm text-sakura">{error}</p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? '请稍候…' : isRegister ? '注册并进入大厅' : '登录'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink/55">
          {isRegister ? '已经有账号了？' : '还没有账号？'}{' '}
          <Link to={isRegister ? '/login' : '/register'} className="font-semibold text-stella hover:underline">
            {isRegister ? '去登录' : '去注册'}
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link to="/" className="text-ink/40 hover:text-ink/70">
            ← 返回首页
          </Link>
        </p>
      </Card>
    </div>
  );
}
