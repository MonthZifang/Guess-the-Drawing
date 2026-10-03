---
feature: sso-room-rules
status: delivered
updated: 2026-10-03
branch: main
commits: 33dabfb..157ab74
---

# SSO 统一登录 + 房间规则与链式画猜（60 人）

## Report

**What was built** — 游戏接入企业 SSO（Go OIDC IdP，本地内存模式常驻 :8080）：授权码+PKCE 全流程（state/nonce/JWKS 校验、按 ssoSub upsert 用户、签发我方 JWT），本地注册与密码登录删除。房间扩容 60 人、邀请码 6 位（32 字符集），开房可配三类规则——画者顺序（按 SSO id 排序 / 每圈洗牌 / 每回合重洗）、画板规则（词库经典 / Draw&Guess 式链式接龙）、回合计法（按人数/固定/自定义）。链式按顺序规则生成链序成对接力（画→猜→传题作画），传题无论猜中与否取猜词者末条输入，链完成自动按段回放笔迹 + 三档投票（回放估时+30 秒窗口）+ 展示词语演化链，两条链后人人画猜各一。前端：SSO 登录页、三组规则表单、60 人滚动列表、链式专属 UI（传题徽标/指定猜词者高亮/回放播放器/投票卡）。

**Verification** — `npm run build` exit 0；`npm test -w apps/server` 77/77（sso.e2e 伪造 IdP、rotation/chain 单测、直签令牌 e2e）；`smoke-game.mjs` 53 项 SMOKE OK；`capacity60.mjs` CAPACITY OK（60 入 61 拒、全员开局、笔迹广播）；`capacity-chain.mjs` CHAIN-CAPACITY OK（26 人 13 段、chain:end 回放、26 票聚合、game:end）；双浏览器真实链路：双账号 SSO 登录 → 6 位码开房（链式+按人数）→ 接龙猜词 → 回放+投票卡（截图 output/t9-vote-card.png）→ 双端 vote:result → 第二链传题 → 再投票 → 结算，21 检查点全过。两轮独立评审：首轮 CHANGES_REQUESTED（C1 大房间回放超投票窗口、2 Major、5 Minor），修复后复审 APPROVE。

**Journey log** — ① 参考游戏锁定为 Steam Draw&Guess（1483870），链序/接龙/回放投票按其接龙模式设计并经用户逐项确认。② websearch 的 Browser Use 基础设施本会话不可用，按例外规则用显式代理抓取用户给的 Steam URL 识别游戏。③ 投票窗口曾是结构性 C1（30s < 回放时长），修复为「回放估时+30s」并以 26 人脚本锚定。④ CLI 浏览器探针屡次错过 30s 投票窗，最终以「单脚本原子化全流程+双端并行」拿到 21 检查点全过。⑤ 期间 Clash 代理核心崩溃导致推送欠账，重启 F:\Clash Verge 恢复；post-commit 钩子在代理故障时告警、恢复后手动补推成功。

## [S1] Problem

在已交付的「你猜我画·二次元」（feature: guess-draw-anime，见 docs/compose/spec/guess-draw-anime.md）基础上：接入 SSO 统一登录并删除本地注册；房间扩容至 60 人、邀请码改为 6 位字母数字；开房时可配置三类规则——画者顺序规则（顺序/随机/混乱）、画板规则（经典词库 / 链式画猜）、回合计法（按人数/固定/自定义）。链式画猜：指定猜词者输入的词（无论是否猜中）原样传给下一棒作画。

## [S2] Design

### SSO 接入（模式 A：有后端的 Web 应用）

- 参考 `C:\Users\43551\Desktop\SSO-feature-sso-idp-core\docs\INTEGRATION-GUIDE.md` 第 4 节；IdP 为 Go OIDC 服务，开发时用 `bin/sso-server.exe` 内存模式跑 `http://127.0.0.1:8080`，生产指到 `SSO_ISSUER`（如 https://mindustry.wiki:1090）
- 客户端注册：`clients.d/guess-draw-anime.json`（confidential、`require_pkce: true`、redirect_uri=`{SERVER_PUBLIC_URL}/auth/sso/callback`、secret 经环境变量注入）；生产环境由 SSO 管理员注册同参数客户端
- 后端流程（NestJS）：
  1. `GET /auth/sso/start`（公开）：生成 state/nonce/PKCE verifier → 存内存 PendingAuth（TTL 10 分钟）→ 302 到 `{SSO_ISSUER}/oauth2/authorize`（response_type=code、scope=`openid profile`、code_challenge_method=S256）
  2. `GET /auth/sso/callback`（公开）：校验 state → `POST {SSO_ISSUER}/oauth2/token`（Basic client_id:secret + code_verifier）→ 用 JWKS 校验 id_token（issuer/aud/nonce，依赖 `jose`）→ `GET {SSO_ISSUER}/oauth2/profile` 取 `data.user_id / public_id / display_name` → 按 `ssoSub` upsert User → 签发我方 JWT（7 天，含 `{sub, username, avatarId}`）→ 302 到 `{FRONTEND_ORIGIN}/login#token=<jwt>`
  3. 身份主键 = `sub`；排序键 = `public_id`（数字，缺省回退 `sub` 字符串）；显示名 = `display_name`
- 删除：`POST /auth/register`、`POST /auth/login`（密码登录）及注册页；`GET /users/me` 保留
- 前端：`/register` 路由删除；`/login` 改为「SSO 统一登录」按钮 → 整页跳转 `/api/auth/sso/start`；回调回 `login#token=` 后写入现有 AuthContext → 跳 `/lobby`
- User 模型（内存）：`{ id, ssoSub(unique), username, publicId|null, avatarId, createdAt }`；avatarId 首次登录按 `hash(sub)%6+1` 分配（注册页头像选择器随之移除）；无密码字段

### 房间基础参数

- 邀请码：6 位，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（32 字，去易混 I/O/0/1），随机等概率
- `maxPlayers = 60`；创建/加入校验、玩家列表 UI 加滚动容器
- 房间创建入参（均必填，带默认值向后兼容）：
  ```
  orderRule: 'id' | 'lapShuffle' | 'roundShuffle'   // 顺序 | 随机 | 混乱
  drawRule:  'classic' | 'chain'                    // 词库经典 | 链式
  rounds:    { mode: 'byPlayers' | 'fixed' | 'custom', value?: 1..60 }
  ```
  - `fixed` 缺省 value=6；`custom` 必填 value；`byPlayers` 在 game:start 时按当时人数解析为 N

### 画者顺序规则（三种，均保证同一作画圈内不重复）

- **顺序 id**：按 `(publicId ?? sub)` 升序生成队列，每圈沿用同一顺序
- **随机 lapShuffle**：每圈开始 Fisher-Yates 洗牌，圈内按洗牌结果走
- **混乱 roundShuffle**：每回合对「本圈未画过的玩家」重新洗牌并取队首；取空即圈结束进入下一圈（整圈重洗）
- 队列引擎抽为纯函数（`rotation.ts`），可单测

### 画板规则（两种）

**经典 classic（=现行为）**：服务端从词库抽词，全员在聊天区猜词；计分不变（猜中 `ceil(100×剩余/80)` 下限 10，画者抽 25% 向下取整）。

**链式 chain（仿 Draw & Guess 接龙模式，Steam 1483870）**：
- **链序**：开局按 `orderRule` 生成链序（id=按 `(publicId??sub)` 升序；lapShuffle/roundShuffle=开局各洗一次牌），此后严格按该序列接力、中途不换序
- **接力结构**：一条链按链序两两成对走完全员——段 i：`drawer = 链序[2i]`、`guesser = 链序[2i+1]`；链长 = `floor(N/2)` 段（N 为奇数时末段猜词者取链序[0]，猜词不算作画）。全员在链中出场（偶位作画、奇位猜词）
- **多链覆盖**：剩余回合继续下一条链时，链序整体轮转一位（offset+1），保证第二条链由另一半玩家作画——两条链后每人恰好作画一次、猜词一次；`byPlayers = N` 段 ≈ 两条链
- **题目传导**：段 0 画者题目来自词库（含类别）；段 k>0 画者题目 = **段 k-1 猜词者输入框的最后一条提交内容（无论是否猜中）**；输入为空则原题继续传导；传题截断 12 字
- **指定猜词者**：仅 `guesserId` 可提交猜词（服务端拒绝他人，`error: 本回合由指定玩家猜词`）；其余玩家观战+闲聊
- **计分**：与经典相同（猜中 `ceil(100×剩余/80)` 下限 10、画者 25% 向下取整）；未猜中不得分但不影响传导
- **段结束**：沿用 `round:end`（公布题目、传给下一段的文本 `passedText`、本段得分）
- **链完成 → 回放 + 投票（D&G 灵魂环节）**：一条链走完进入 `chain:end`——先自动按段序回放本链全部笔迹（复用房间已存 strokes，带段切换提示），随后全员投票「最终的词和最初的词还是同一个东西吗？」（三档：完全一样 / 有点跑偏 / 面目全非），投票不计分；展示投票结果与**完整词语演化链**（词库词→…→最终词），然后开始下一条链（offset+1）或进入整场结算

### 回合计法（开房设置）

- `byPlayers`：总回合 = 开局时人数 N（经典模式=人人画一次；链式=每人画+猜各一次）
- `fixed`：固定 value 回合（默认 6）
- `custom`：自定义 value（1–60）
- 解析后的 `totalRounds` 随 `room:state` / 快照下发，前端显示 `回合 x/total`

### Socket / REST 增量

- `POST /rooms` 入参增加 `orderRule/drawRule/rounds`；`GET /rooms/:code` 与 `room:state` 返回这些字段 + `totalRounds` + 链式态（`prompt`、`promptCategory?`、`guesserId`、`chainIndex`/`chainTotal`）
- `guess`：classic 行为不变；chain 仅 `guesserId` 可发，回包/广播不变，传导内容在 `round:end` 带出（`passedText`、`wordTrail` 词语演化链）
- 新增链事件：服务端 → `chain:end { segments: [{drawerId, guesserId, prompt, passedText}], wordTrail, replay: [{roundNo, strokes, prompt}] }`（触发回放）；投票 `vote:cast { choice: 1|2|3 }`（每人一次）→ 服务端聚合广播 `vote:result { counts, wordTrail }`；全员投票完成（或 30 秒超时）后进入下一条链或 `game:end`
- 其余事件契约沿用 guess-draw-anime 规格

### 测试边界（Jest + Supertest）

- `sso.e2e`：进程内伪造 IdP（discovery/JWKS RS256/token/userinfo/profile）驱动 start→callback，断言 302 至前端 `#token=`、我方 JWT 可用 `/users/me`、state 不匹配 400、重复 ssoSub upsert 不重复建号；`/auth/register` 404
- `rotation.spec`：三种规则队列序、圈内不重复、roundShuffle 取空重建、byPlayers 解析
- `chain.spec`：配对推进（含奇数 N）、offset+1 换链后另一半作画、末条输入传导、空输入续传、12 字截断、非指定猜词者拒绝、wordTrail 累积
- 既有 rooms/matches e2e：改用 `JwtService.signAsync` 直签测试令牌
- smoke-game：classic 回归 + 新增 chain 段（2 人：A 画→B 输入「xyz」→下一段 B 作画且题目为 xyz→链完成收到 `chain:end`、投票 `vote:result` 后进入下一段/结束）

## [S3] Out of Scope

- SSO 生产客户端注册与密钥分发（运维动作，规格只留参数清单）
- refresh_token 续期 / 静默续期（沿用我方 7 天 JWT）
- 头像选择 UI、错误答案全员广播、观战者角色
- 移动端适配、CI、逐回合历史明细
- SSO 服务本身的改动（只作为接入方）

## Tasks

- [x] T1: SSO 本地运行与客户端注册 — acceptance: `sso-server.exe` 内存模式启动于 :8080；`clients.d/guess-draw-anime.json` 就位（env 注入 secret）；`GET /.well-known/openid-configuration` 与授权跳转 302 手测通过 (covers: S2 SSO接入; depends: —)
- [x] T2: 后端 SSO 登录与注册移除 — acceptance: start/callback/PKCE/JWKS 校验/用户 upsert/我方 JWT 全链路 e2e 通过（伪造 IdP）；register/login 密码端点移除且返回 404；`sso.e2e-spec` + 既有 rooms/matches e2e（改直签令牌）全绿 (covers: S2 SSO接入/测试边界; depends: T1)
- [x] T3: 房间规则与链式引擎（后端）— acceptance: 6 位邀请码、60 人上限、orderRule/drawRule/rounds 入参与快照下发；rotation 三规则 + 链式配对/offset换链/传导/计分/词语链纯函数单测全绿；`chain:end` 回放数据与 `vote:cast/vote:result` 聚合实现；smoke classic 回归 + chain 段（含投票）通过 (covers: S2 房间基础/顺序规则/画板规则/回合计法/Socket增量; depends: T2)
- [x] T4: 前端登录与规则 UI — acceptance: 注册页删除、登录页 SSO 按钮走通 `#token=` 回填；开房表单含三组规则选择（含自定义回合输入）；60 人列表可滚动；链式 UI：传题题目栏、指定猜词者高亮与专属输入、非指定者仅闲聊、`x/total` 回合显示；链完成回放播放器（按段播放笔迹）+ 三档投票卡 + 词语演化链展示 (covers: S2 SSO接入前端/房间基础/画板规则; depends: T2, T3)
- [x] T5: 验证 — acceptance: `npm run build`、`npm test -w apps/server`、smoke 全绿；双浏览器手测：SSO 登录→开房选规则→链式整圈对局→经典回归→60 人容量压测（脚本模拟） (covers: S2 全部; depends: T4)
- [x] T6: 评审 — acceptance: 独立评审对 T1–T5 变更给出 spec compliance / correctness / consistency 三结论，Critical 清零 (covers: S2; depends: T5)
