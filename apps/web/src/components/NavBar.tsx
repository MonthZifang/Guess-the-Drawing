import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Avatar, Button } from './ui';

const links = [
  { to: '/lobby', label: '大厅' },
  { to: '/history', label: '历史' },
  { to: '/leaderboard', label: '排行' },
];

export function NavBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-white/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <NavLink to="/lobby" className="font-display text-xl text-sakura hover:brightness-110">
          你猜我画<span className="text-stella">·</span>二次元
        </NavLink>
        <nav className="ml-2 flex gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                  isActive ? 'bg-sakura/15 text-sakura' : 'text-ink/60 hover:bg-white hover:text-ink'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {user && (
            <div className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 shadow-sm">
              <Avatar user={user} size={30} />
              <span className="max-w-[120px] truncate text-sm font-semibold">{user.username}</span>
            </div>
          )}
          <Button
            variant="ghost"
            className="px-4 py-1.5 text-sm"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            退出
          </Button>
        </div>
      </div>
    </header>
  );
}
