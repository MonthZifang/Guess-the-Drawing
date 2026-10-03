import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, PageTitle } from '../components/ui';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';

/** 规格：我方 JWT 含 { sub, username, avatarId }，身份主键 = sub */
function decodeJwtUser(jwt: string): User | null {
  try {
    const seg = jwt.split('.')[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const username = typeof payload.username === 'string' ? payload.username : '';
    if (!username || typeof payload.sub !== 'string' || !payload.sub) return null;
    const avatarId =
      typeof payload.avatarId === 'number' || typeof payload.avatarId === 'string'
        ? payload.avatarId
        : undefined;
    return { id: payload.sub, username, avatarId };
  } catch {
    return null;
  }
}

export default function Login() {
  const { token, signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    const m = window.location.hash.match(/[#&]token=([^&]+)/);
    if (!m) {
      // 已登录用户直接进大厅
      if (token) navigate('/lobby', { replace: true });
      return;
    }
    const jwt = decodeURIComponent(m[1]);
    const user = decodeJwtUser(jwt);
    // 清 hash（避免 token 留在地址栏 / 被后续路由继承）
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!user) {
      setError('登录令牌无效，请重新点击统一登录');
      return;
    }
    signIn(jwt, user);
    navigate('/lobby', { replace: true });
  }, [token, signIn, navigate]);

  function startSso() {
    // 整页跳转：后端 302 过 SSO 再回 /login#token=<jwt>
    window.location.href = '/api/auth/sso/start';
  }

  return (
    <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center overflow-hidden px-4">
      {/* 二次元 hero 背景 */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(135deg,#ffd9e8_0%,#f6f4ff_45%,#e4deff_100%)]">
        <span className="gd-float absolute left-[12%] top-[18%] text-3xl">🌸</span>
        <span className="gd-float absolute right-[16%] top-[26%] text-2xl" style={{ animationDelay: '1.2s' }}>
          ✦
        </span>
        <span className="gd-float absolute bottom-[22%] left-[22%] text-2xl" style={{ animationDelay: '0.6s' }}>
          ✦
        </span>
        <span className="gd-float absolute bottom-[16%] right-[12%] text-3xl" style={{ animationDelay: '1.8s' }}>
          🌸
        </span>
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-white/40 blur-2xl" />
        <div className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-sakura/20 blur-3xl" />
      </div>

      <Card className="w-full max-w-md p-8 text-center gd-pop">
        <p className="mb-3 inline-block rounded-full bg-white/80 px-4 py-1 text-sm font-semibold text-stella shadow-sm">
          Mindustry 词库 · 多人实时绘画猜词
        </p>
        <PageTitle>
          你猜我画<span className="text-sakura">·</span>
          <span className="text-stella">二次元</span>
        </PageTitle>
        <p className="mt-2 text-sm text-ink/55">
          使用统一账号（SSO）登录，登录后直接进入大厅开一局。
        </p>

        {error && (
          <p className="gd-shake mt-4 rounded-xl bg-sakura/10 px-3 py-2 text-sm text-sakura">{error}</p>
        )}

        <Button className="mt-6 w-full py-3.5 text-lg" onClick={startSso}>
          🔐 SSO 统一登录
        </Button>
        <p className="mt-3 text-xs text-ink/45">跳转到统一认证中心，登录成功后自动返回</p>

        <p className="mt-5 text-center text-sm">
          <a href="/" className="text-ink/40 hover:text-ink/70">
            ← 返回首页
          </a>
        </p>
      </Card>
    </div>
  );
}
