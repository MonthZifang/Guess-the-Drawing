---
feature: nav-rooms
status: in-progress
updated: 2026-10-03
branch: main
commits:
---

# 全站导航栏 + 房间列表

## Report

## [S1] Problem

当前导航分裂：NavBar 只挂在大厅/历史/排行三页，落地页、登录页、对局页各用各的头部；没有「所有房间」的可见入口，玩家只能凭 6 位码加入。需要一条全站导航：首页、个人登录状态、创建房间、房间列表（展示所有可加入房间）。

## [S2] Design

### 全站导航栏（升级现有 components/NavBar.tsx）

- 结构：左侧 Logo（→ 链接首页 `/`）｜中部链接：**首页** `/`、**房间列表** `/rooms`、**创建房间** `/lobby#create`、历史 `/history`、排行 `/leaderboard`｜右侧个人区
- 个人区：未登录 → 「SSO 登录」按钮（跳 `/login`）；已登录 → 头像+昵称胶囊，点击展开小菜单含「退出」
- 挂载范围：Landing、Login、Room（置于房间工具条之上）、Lobby、History、Leaderboard 全部使用同一 NavBar；各页自建头部仅保留页面专属部分（如 Room 的房间码/回合计时工具条移到 NavBar 下方）
- `创建房间`：`navigate('/lobby#create')`；Lobby 挂载时若 hash 为 `#create` 则对创建卡片（`id="create"`）`scrollIntoView`

### 房间列表（新页 /rooms）

- 后端：`RoomRegistry.list()` 返回非 `finished` 房间；`GET /rooms`（JWT 保护）→ `[{ code, status, ownerId, playerCount, maxPlayers, orderRule, drawRule, rounds, totalRounds }]`，按创建时间倒序（registry 内插入序即可）
- 前端 `/rooms`（Protected）：卡片网格——房间码（等宽大字）、状态徽标（等待中/对局中）、人数 `x/60`、三枚规则标签（顺序/画板/回合）、加入按钮（waiting→「加入」，playing→「进入对局」，均跳 `/room/:code`）；5 秒轮询 + 手动刷新；空态「暂无房间，来创建第一个吧」
- 登录前访问 `/rooms` 沿用 Protected 重定向 `/login`

### 测试边界

- rooms e2e 新增：创建两房 → `GET /rooms` 含两者与 playerCount；对局结束的房间不出现在列表（内存造 finished 态或跑完短局）
- 前端以构建 + 浏览器走查验证（无自动化测试，沿用既有约定）

## [S3] Out of Scope

- 房间搜索/分页/筛选（房间量级为内存单实例，全量足够）
- 房间公告、房主踢人、好友邀请
- 移动端底部导航栏变体

## Tasks

- [ ] T1: 房间列表接口 — acceptance: `GET /rooms` 返回非 finished 房间数组（含 code/status/人数/规则），e2e 断言覆盖创建后可见、finished 不可见 (covers: S2 房间列表后端)
- [ ] T2: 全站导航栏与 /rooms 页 — acceptance: 六个页面共用同一 NavBar（首页/房间列表/创建房间/历史/排行/个人区），未登录见 SSO 登录按钮、已登录见头像菜单可退出；`/rooms` 卡片网格 5 秒轮询、加入按钮跳转正确；`#create` 锚点滚动生效 (covers: S2 导航栏/房间列表前端; depends: T1)
- [ ] T3: 验证与评审 — acceptance: `npm run build`、`npm test -w apps/server` 全绿；浏览器走查：导航全页面可达、房间列表实时显示新房间；独立评审 APPROVE (covers: S2 全部; depends: T2)
