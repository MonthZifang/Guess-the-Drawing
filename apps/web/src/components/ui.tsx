import { useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { User } from '../lib/types';

/* ---------- 预设头像契约：/avatars/avatar1.svg … avatar6.svg ---------- */

export const AVATAR_COUNT = 6;

export function pickAvatarIndex(avatarId: number | string | undefined, seed = ''): number {
  if (typeof avatarId === 'number' && Number.isFinite(avatarId)) {
    const n = Math.abs(Math.trunc(avatarId));
    return ((n - 1) % AVATAR_COUNT) + 1;
  }
  if (typeof avatarId === 'string') {
    const m = avatarId.match(/\d+/);
    if (m) return ((Number(m[0]) - 1) % AVATAR_COUNT) + 1;
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % AVATAR_COUNT) + 1;
}

export function avatarSrc(avatarId: number | string | undefined, seed = ''): string {
  return `/avatars/avatar${pickAvatarIndex(avatarId, seed)}.svg`;
}

export function Avatar({
  user,
  size = 40,
  className = '',
}: {
  user: Pick<User, 'username' | 'avatarId'> | null | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const username = user?.username ?? '?';
  const src = avatarSrc(user?.avatarId, username);
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full bg-stella/15 ring-2 ring-white ${className}`}
      style={{ width: size, height: size }}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center font-display text-stella" style={{ fontSize: size * 0.45 }}>
          {username.slice(0, 1)}
        </div>
      ) : (
        <img
          src={src}
          alt={username}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/* ---------- 基础组件 ---------- */

type ButtonVariant = 'primary' | 'stella' | 'mint' | 'ghost';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-sakura text-white shadow-lg shadow-sakura/30 hover:brightness-105 active:scale-[0.97]',
  stella:
    'bg-stella text-white shadow-lg shadow-stella/30 hover:brightness-105 active:scale-[0.97]',
  mint: 'bg-mint text-white shadow-lg shadow-mint/30 hover:brightness-105 active:scale-[0.97]',
  ghost:
    'bg-white text-ink/80 border-2 border-ink/10 hover:border-sakura/40 hover:text-ink active:scale-[0.97]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`rounded-2xl px-5 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Card({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/80 bg-white/90 shadow-[0_12px_32px_-16px_rgba(46,38,69,0.35)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-2xl border-2 border-ink/10 bg-white px-4 py-2.5 outline-none transition placeholder:text-ink/35 focus:border-sakura/60 focus:ring-4 focus:ring-sakura/15 ${className}`}
      {...rest}
    />
  );
}

export function PageTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={`font-display text-3xl text-ink ${className}`}>{children}</h1>
  );
}
