import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Card } from '../components/ui';

const petals = [
  { left: '6%', top: '18%', size: 26, delay: '0s', color: '#ff6fa5' },
  { left: '18%', top: '62%', size: 18, delay: '1.2s', color: '#ffb3cd' },
  { left: '78%', top: '24%', size: 30, delay: '0.6s', color: '#ff6fa5' },
  { left: '88%', top: '58%', size: 20, delay: '1.8s', color: '#c9bfff' },
  { left: '46%', top: '12%', size: 16, delay: '2.4s', color: '#ffd93d' },
  { left: '64%', top: '70%', size: 22, delay: '0.3s', color: '#ffb3cd' },
];

function Petal({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2c3 4 7 6 7 11a7 7 0 0 1-14 0c0-5 4-7 7-11Z"
        fill={color}
        opacity="0.85"
      />
    </svg>
  );
}

const features = [
  {
    title: '实时画板',
    desc: '1024×768 逻辑画布、指针事件出笔，笔迹带樱花样式的粒子尾迹，好友端实时同步。',
    accent: 'text-sakura',
  },
  {
    title: '你画我猜对局',
    desc: '房间码邀请、6 回合轮换画者、倒计时抢分、猜对花瓣飘落，房主一键开局。',
    accent: 'text-stella',
  },
  {
    title: '战绩与排行',
    desc: '每场对局入库，最近 20 场历史可查，总分 Top 10 排行榜见证画神诞生。',
    accent: 'text-mint',
  },
];

export default function Landing() {
  const { token } = useAuth();
  if (token) return <Navigate to="/lobby" replace />;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <span className="font-display text-xl text-sakura">你猜我画·二次元</span>
        <div className="flex gap-3">
          <Link to="/login">
            <Button variant="ghost" className="py-2">
              登录
            </Button>
          </Link>
          <Link to="/register">
            <Button className="py-2">注册</Button>
          </Link>
        </div>
      </header>

      {/* Hero：纯 CSS 渐变底 + 樱花瓣/星光装饰（横幅图片已取消） */}
      <section className="relative overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffd9e8_0%,#f6f4ff_45%,#e4deff_100%)] px-6 py-16 shadow-[0_24px_60px_-28px_rgba(123,108,246,0.5)] sm:px-12">
        <div className="pointer-events-none absolute inset-0">
          {petals.map((p, i) => (
            <div
              key={i}
              className="gd-float absolute"
              style={{ left: p.left, top: p.top, animationDelay: p.delay }}
            >
              <Petal size={p.size} color={p.color} />
            </div>
          ))}
          <span className="gd-twinkle absolute left-[30%] top-[22%] text-2xl text-white">✦</span>
          <span className="gd-twinkle absolute right-[24%] top-[40%] text-xl text-star" style={{ animationDelay: '0.9s' }}>✦</span>
          <span className="gd-twinkle absolute left-[12%] bottom-[18%] text-lg text-stella" style={{ animationDelay: '1.5s' }}>✦</span>
          <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-white/40 blur-2xl" />
          <div className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-sakura/20 blur-3xl" />
        </div>

        <div className="relative z-10 text-center">
          <p className="mb-3 inline-block rounded-full bg-white/80 px-4 py-1 text-sm font-semibold text-stella shadow-sm">
            Mindustry 词库 · 多人实时绘画猜词
          </p>
          <h1 className="font-display text-5xl leading-tight text-ink sm:text-7xl">
            你猜我画
            <span className="text-sakura">·</span>
            <span className="text-stella">二次元</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink/60 sm:text-lg">
            一人执笔、众人抢猜。樱花笔迹随指尖飘落，猜中的瞬间花瓣漫天——
            和朋友开一局蔚蓝档案式清爽画房吧！
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link to="/register">
              <Button className="px-8 py-3 text-lg">开始游戏 →</Button>
            </Link>
            <Link to="/login">
              <Button variant="ghost" className="px-8 py-3 text-lg">
                已有账号
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="p-6 transition hover:-translate-y-1 hover:shadow-xl">
            <h3 className={`font-display text-xl ${f.accent}`}>{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">{f.desc}</p>
          </Card>
        ))}
      </section>

      <p className="mt-8 text-center text-sm text-ink/40">
        房间 2–8 人 · 默认 6 回合 × 80 秒 · 房主开局
      </p>
    </div>
  );
}
