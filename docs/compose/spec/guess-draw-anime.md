---
feature: guess-draw-anime
status: delivered
updated: 2026-10-03
branch: feature/guess-draw-anime
commits: a6db8a0..d415b72
---

# 你猜我画·二次元（Mindustry 词库）

## Report

**What was built** — 完整可玩的多人实时「你猜我画」：npm workspaces 单仓库，NestJS + Socket.IO 后端（JWT 认证、房间、6 回合×80 秒对局、计分、对局历史与 Top10 排行）与 React 18 + Vite + Tailwind 二次元前端（三栏对局页、画板实时同步、聊天猜词、揭示卡/粒子尾迹/花瓣三处标志性瞬间、6 选 1 SVG 头像）。词库从 Mindustry zh_CN 语言包提取，严格 2–6 字过滤，共 432 词（BUILDING 350 / UNIT 58 / LIQUID 10 / ITEM 14）。数据层为双模式仓储接口：当前内存模式（用户批准），Prisma schema 已提交，远程 PostgreSQL 连接串就绪后接入即切。经两轮独立评审：首轮 CHANGES_REQUESTED（3 critical），修复 category 下发、断线保留（刷新不丢分）、词库长度污染后复审 APPROVE。

**Verification** — `npm run build` exit 0（web+server）；`npm test -w apps/server` 50/50 全绿（含 auth/rooms/matches e2e、scoring/word-rules 单测）；`node scripts/smoke-game.mjs` 28 项 SMOKE OK（含画者收词+类别、断线系统提示、双角色重连后玩家/分数/词重发）；词库提取两次 SHA256 一致；双浏览器真实走查：注册→建房→加入→6 回合整场对局→结算→历史/排行，效果数值取证（粒子层 2323 非透明像素、猜中 .gd-petal×22、计分 +10/+2 与公式吻合）。

**Journey log** — ① image_gen 会员 403 → 头像/横幅改手绘 SVG+CSS（规格修订）。② 前后端并行子代理实现，以规格 Socket/REST 契约 + 服务端真实负载转发对齐。③ playwright 后台页截图反复拿到旧帧 → 改用页内数值取证（canvas 像素计数、DOM 元素计数）作为效果证据。④ 首轮评审 3 critical → 断线保留采用「显式 room:leave 才移除、断线仅置离线」的前后端分界（leaveIntentRef）。⑤ LIQUID/ITEM 在源包仅 11/22 条名称，词数以源上限交付并写入规格。

## [S1] Problem

用户想要一个"你猜我画"（Gartic 式）多人实时绘画猜词游戏的二次元风格版本：一人画画、多人在聊天框猜词，回合轮换、计分排名。词库不是通用词汇，而是取自 Mindustry 游戏源码的建筑、单位、液体、物品等中文名词，让玩家圈更有辨识度。第一期为可玩的完整多人对局（房间、实时画板、聊天猜词、计分、对局历史与简单排行），前端二次元美术风格。

## [S2] Design

### 技术栈（已与用户商定）

- 前端：React 18 + Vite + TypeScript + Tailwind CSS，Socket.IO 客户端
- 后端：NestJS + Prisma + PostgreSQL + JWT + @nestjs/websockets（Socket.IO）——**不用 Go**（用户已确认纯 NestJS）
- 数据库阶段性策略（用户决定）：**先启用内存模式**——`DATABASE_URL` 缺失时走内存仓储；远程 PostgreSQL 连接串由用户稍后提供，配置后切换到 Prisma/Postgres 实现，应用代码不改
- 测试：Jest + Supertest（后端）；前端自动化测试本期不做
- 仓库：单仓库 npm workspaces，`apps/web` + `apps/server`

### 视觉方向（二次元）

- 风格锚点：日系二次元手游界面（蔚蓝档案式清爽卡片 + 同人游戏的俏皮感）
- 色板：背景薰衣草白 `#F6F4FF`；墨色 `#2E2645`；主强调樱粉 `#FF6FA5`；辅助星紫 `#7B6CF6`；猜对成功色薄荷 `#3ECFA0`
- 字体：标题站酷快乐体（ZCOOL KuaiLe，回退 PingFang SC / Microsoft YaHei），正文系统无衬线；圆角卡片（rx≥12px）、8px 间距节奏
- 布局：居中 max-w-6xl 三栏对局页——左玩家列表 / 中画板 / 右聊天猜词
- 标志性瞬间：① 画笔带樱花样式的粒子尾迹；② 回合开始时二次元角色立绘卡翻转揭示题目（仅画者看到词）；③ 猜对时彩带/花瓣飘落
- 图像资源：image_gen 服务不可用（会员 403，2026-02 确认）→ 预设头像改为**手绘 SVG**（6 个 Q 版二次元头像放 `apps/web/public/avatars/*.svg`）；标题横幅与回合立绘卡用纯 CSS/SVG 自绘；用户从预设头像中选择，不支持上传

### 词库生成

- 来源：`C:\Users\43551\Desktop\Mindustry-master\core\assets\bundles\bundle_zh_CN.properties` 中 `block.*` / `unit.*` / `liquid.*` / `item.*` 的中文名（约 899 条候选）
- 一次性提取脚本 `apps/server/scripts/extract-words.mjs` 运行后生成受控词库 `apps/server/prisma/words.json` 并提交入库（运行时不再依赖 Mindustry 源码路径）
- 过滤：取 2–6 个汉字的名词；去重；剔除含数字/字母/标点的条目；类别映射为 `BUILDING | UNIT | LIQUID | ITEM`
- 难度：字数 2–3 = 1（易），4 = 2（中），5–6 = 3（难）
- 数量目标：BUILDING/UNIT 每类 ≥ 40；LIQUID/ITEM 以源数据为上限（zh_CN 包中 `.name` 仅 11/22 条，剔除单字后无法达标，实际交付 BUILDING 350 / UNIT 58 / LIQUID 10 / ITEM 14，合计 432；长度严格 2–6 字，不放宽）
- 加载：内存模式启动时读 `words.json` 装入 `WordStore`；Postgres 模式由种子脚本写入 `Word` 表

### 对局规则

- 房间：2–8 人，房间码加入；默认 6 回合，每回合 80 秒；房主（创建者）点开始
- 回合：按加入顺序轮换画者；画者看到题目词（含类别），其他玩家只看到字数提示
- 猜词：聊天框输入；规范化（去空格、全角转半角、忽略大小写）后与目标词完全一致即猜中；猜中者本回合不能再得分，但可继续聊天
- 计分：猜中者得分 = `ceil(100 × 剩余秒数 / 80)`，下限 10；画者得分 = 所有猜中者得分之和 × 25%（向下取整）
- 回合结束：时间到或全部非画者玩家猜中；公布题目与各家得分
- 全部回合结束：按总分排名；对局与各玩家得分入库

### 画板同步

- 画布逻辑尺寸固定（1024×768），前端按容器缩放显示
- 笔迹以事件流传输：`stroke { x, y, color, width, down }`（相对坐标 0–1），服务端仅转发不落库
- 房间保存本次对局的笔迹数组；中途加入者先回放已有笔迹再接收实时流
- 画者工具：6 色调色板（含樱粉/星紫等）、固定线宽、清空画布（仅画者）；橡皮擦与撤销本期不做

### REST 接口（JWT 除注明外均需鉴权）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | `{username, password, avatarId?}` → `{accessToken, user}`（avatarId 默认 1，取值 1–6） |
| POST | `/auth/login` | 同上 |
| GET | `/users/me` | 当前用户 |
| POST | `/rooms` | 创建房间 → `{code, ...}` |
| GET | `/rooms/:code` | 房间快照（用于刷新恢复） |
| GET | `/matches/recent` | 最近 20 场对局 |
| GET | `/leaderboard` | 总分 Top 10 |

### Socket.IO 事件（`/game` 空间，握手带 JWT）

客户端 → 服务端：`room:join {code}`、`room:leave`、`game:start`（仅房主）、`stroke`、`guess {text}`、`chat {text}`、`tool:clear`（仅当前画者）

服务端 → 客户端：`room:state`、`player:joined`、`player:left`、`game:started`、`round:start {roundNo, drawerId, word?, charCount, endsAt}`、`stroke`、`tool:cleared`、`guess:correct {playerId, gained}`、`chat`（含系统提示行）、`round:end {word, scores}`、`game:end {results}`、`timer {remaining}`、`error {message}`

错误行为：非法房间码/满员/未开始即猜词等返回 `error` 事件且不中断连接；JWT 无效则握手拒绝。

### 数据存储（双模式）

仓储接口 `UserStore / WordStore / MatchStore`，由 NestJS DI 按环境注入：

- **内存模式（当前阶段）**：`DATABASE_URL` 未配置 → 进程内 Map 实现；`words.json` 启动时加载；用户与对局仅存内存，重启清空（多人对局在同一实例内，不受影响）
- **Postgres 模式（远程库就绪后）**：配置 `DATABASE_URL` → 届时补入同一接口的 Prisma 实现并执行 `prisma migrate` + 种子；本期交付仓储接口、内存实现与 schema 文件（不写未验证的数据库代码）
- Prisma schema（`User/Match/MatchPlayer/Word`）随代码提交，第一期不执行 migrate
- 实体形状：`User(id, username 唯一, passwordHash, avatarId, createdAt)`、`Match(id, roomCode, rounds, endedAt)` + `MatchPlayer(matchId, userId, score, rank)`、`Word(id, text 唯一, category, difficulty)`
- 认证与存储无关：bcrypt 密码哈希、JWT access token（7 天），两种模式一致

### 测试边界（Jest + Supertest）

- Auth e2e：注册/登录/重复用户名/错误密码/无 token 访问受保护路由
- Rooms e2e：创建/加入/快照；计分纯函数单测（剩余时间→得分曲线）
- 词库提取脚本的过滤与分类单测
- Socket 对局流程以手测清单验证（本期不写 ws e2e）

## [S3] Out of Scope

- Go 服务、微服务拆分
- 排行榜/匹配以外的社交：好友、战队、私聊
- 词库热更新后台、自定义词库上传
- 画者换词/跳词、笔画撤销、橡皮擦、图片上传作画
- 逐回合历史明细（只存每场总分）
- 前端自动化测试、E2E 框架、CI 部署
- 移动端专项适配（保证不破版即可）

## Tasks

- [x] T1: monorepo 脚手架 — acceptance: `apps/web`（Vite+React+TS+Tailwind）与 `apps/server`（NestJS+Prisma）在 npm workspaces 下安装成功，`npm run build -w apps/web`、`npm run build -w apps/server` 均通过 (covers: S2 技术栈)
- [x] T2: 词库提取与存储仓储 — acceptance: 提取脚本从 Mindustry 中文包生成 `words.json`（BUILDING/UNIT 各 ≥40，LIQUID/ITEM 按源数据上限全量保留，2–6 字过滤），过滤/分类单测通过；仓储接口 + 内存实现完成，启动即加载词库；Prisma schema 已提交（migrate 留待远程库就绪）(covers: S2 词库生成/数据存储; depends: T1)
- [x] T3: 认证模块 — acceptance: register/login/users-me 三个接口 e2e 通过（含重复用户名、错误密码、401 无 token 用例），JWT 签发与 bcrypt 校验生效（跑在内存仓储上）(covers: S2 REST/数据存储; depends: T2)
- [x] T4: 房间与对局后端 — acceptance: 房间 REST（创建/快照）e2e 通过；计分纯函数单测通过；Socket 网关实现 join/笔迹转发/猜词判定/回合计时/计分入库全链路，`npm test -w apps/server` 全绿 (covers: S2 对局规则/画板同步/Socket; depends: T3)
- [x] T5: 前端骨架与设计系统 — acceptance: Tailwind 落地色板与圆角卡片风格，落地页/登录注册页可完成注册→登录并存 token，路由守卫生效 (covers: S2 视觉方向/REST; depends: T3)
- [x] T6: 前端对局页 — acceptance: 三栏布局；创建/加入房间；画板指针事件出笔且经 socket 实时同步到第二客户端；聊天猜词、回合轮换、计时与结算界面完整可玩 (covers: S2 对局规则/画板同步/布局; depends: T4, T5)
- [x] T7: 二次元资产与标志性瞬间 — acceptance: 6 个手绘 SVG 头像接入注册/大厅/对局页，落地页 hero 纯 CSS；回合揭示立绘卡（截图证实）、画笔粒子尾迹（粒子层 2323 像素）、猜对花瓣（.gd-petal×22）三处效果均实测可见 (covers: S2 视觉方向; depends: T6)
- [x] T8: 对局历史与排行 — acceptance: 对局结束分数落库；`/matches/recent`、`/leaderboard` 对应页面展示正确 (covers: S2 REST; depends: T4, T5)
- [x] T9: 验证 — acceptance: `npm run build`（web+server）、`npm test -w apps/server`、TypeScript 无错误全部通过；双浏览器手测清单走通（注册→建房→加入→整场对局→历史/排行）(covers: S2 全部; depends: T7, T8)
