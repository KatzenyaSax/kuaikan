# 交付顺序

唯一准则：**尽早让最危险的集成点暴露**，而不是尽早把某个服务的接口写全。每个阶段都是一条能从浏览器点通的垂直切片，禁止"先把某服务的接口全写完"。

## 进度

- ✅ **P0 已完成**：8 个服务 + 5 个中间件共 13 个容器全部 healthy，
  `deploy/bin/verify.sh` 16 条断言全绿，冷启动 120 秒。实测版本见 `docs/project.md`。
- ✅ **P0.5 前端基础设施已完成**：`verify-p05.sh` 11 条自动断言全绿（2 条人工）。
  `https://www.katzenyasax.top/` 已是真实 React 应用并显示 7 个服务的实时状态。
- ✅ **P1 已完成**：`verify-p1.sh` 33 条自动断言 + 3 条人工全绿（含 P1.6 个人资料）。
  8 个服务 + 5 个中间件健康运行，注册关闭，开发账号可用。

## 阶段表

| 阶段 | 内容 | 位置理由 | 验收标准 |
|---|---|---|---|
| ✅ **P0 版本矩阵 spike（已完成）** | 骨架 → 多阶段 Dockerfile → Compose 编排（core + app）→ Nacos 注册 → 网关路由 → Feign 调用 → Sentinel 规则 → RocketMQ 收发 → MyBatis-Plus → Redis | 版本兼容是全项目最大未知数，必须在写业务前清零 | `React → Nginx → 网关 → user-service` 的 `/ping`（匿名放行）打通，**且全部进程在服务器上以容器运行、按 healthcheck 顺序启动、单服务重建可在 90 秒内完成**；实际版本号回写 `docs/project.md` |
| ✅ **P0.5 前端基础设施（已完成）**（细化见 [`p05-frontend.md`](./p05-frontend.md)） | `web/` 脚手架（Vite 8 + React 19 + TypeScript 6 strict + Tailwind 4 + Router 8 + TanStack Query 5）、HTTP 层解包 `Result<T>`、**类型由后端 OpenAPI 生成**、双环境配置、`npm run build` 发布通道，以及**一个跑真实数据的空壳页面** | 前端工具链的未知数（TS 严格模式、Vite proxy、路径别名、构建产物部署、类型生成）若混在 P1 的登录功能里排查，会分不清"是登录写错了还是脚手架配错了"。与 P0 同性质：先用最小代价清零工具链风险 | `npm run typecheck` 0 error；`npm run build` 成功；`https://www.katzenyasax.top/` 显示真实 React 应用且**至少有一个请求打到后端真数据**；`/test/` 仍可用；未匹配路由显示 404 而非白屏；`types.d.ts` 由 openapi 生成而非手写 |
| ✅ **P1 身份切片（已完成）** | 邮箱验证码注册、登录、JWT + JWKS、Redis 白名单、网关验签与注入身份头、前端登录态 | 所有后续功能都依赖身份；一次验证网关/用户/前端/Redis 四条线 | 登出立刻失效；踢下线立刻生效；后端服务端口对公网不可达 |
| **P2 内容读路径** | 建社群、加入社群、发帖、社群帖列表、帖子详情（游客可读）、双栏阅读界面 | 详见 [`p2-content.md`](./p2-content.md) | 游客能浏览；登录能发帖；**此阶段刻意不含评论与计数** |
| ✅ **P3 评论 + 互动（已完成）** | 评论（存储任意深度/展示两级、游标分页）、点赞、收藏、outbox、RocketMQ、content 消费事件更新计数、对账 | 详见 [`p3-interaction.md`](./p3-interaction.md)；计数一致性边界见 [ADR 0010](./../adr/0010-count-consistency.md) | 点赞后计数 5 秒内变化；**kill 掉 content-service 再点赞，重启后对账任务把计数修回** |
| ✅ **P4 消息中心（已完成）** | 消费点赞/评论/@/封禁事件（**收藏不发消息**）、消息快照、四分类未读、SSE 推送、红点、单条与全部已读、点击跳转、连赞折叠 | 详见 [`p4-notification.md`](./p4-notification.md)；未读数用 MySQL 而非 Redis 计数器（有意偏离架构 §7） | `verify-p4.sh` **43 条断言全绿** |
| ✅ **P5 排行（已完成）** | rank-service 定时算日榜/周榜写 ZSet（Top 50 不分页）；热度 = 多因子加权 + 时间衰减；帖子内评论按热度排序（在 content 内） | 详见 [`p5-rank.md`](./p5-rank.md)。**热度口径已重做**：多因子（评论/收藏/分享/点赞/浏览）+ log2 + 时间衰减 | `verify-p5.sh` **39 条断言全绿** |
| ✅ **P5.5 社交关系与个人中心（已完成）** | 关注关系（`t_user_follow`，上限 200）、第五类 `FOLLOW` 站内消息（24h 冷却防刷）、双栏 `/following` 关注流、公开 `/u/:userId` 主页（发帖/社群/关注/粉丝）、`/me` 增强（修改密码全端踢下线 + 我的收藏） | 详见 [`p55-social.md`](./p55-social.md)；补全顶栏「关注」与用户主页占位页，独立于 P6 搜索 / P7 治理推进 | `verify-p55.sh` **105 条断言全绿**（L0~L4，0 失败） |
| ✅ **P6 搜索（已完成）** | search-service + ES 8.17.4 + IK 8.17.4，异步三事件消费（发帖/删帖/改昵称同步）、零停机别名重建、对外 `/api/search/posts` 与面向未来 AI 助手的对内 `/internal/search/posts`、前端顶栏搜索与 `/search` 页 | 详见 [`p6-search.md`](./p6-search.md) | `verify-p6.sh` **100 条断言全绿**（L0~L4，0 产品缺陷；ES 停机降级 503 且不影响发帖与浏览） |
| ✅ **P7 社群权限与治理（已完成）** | 单一社群管理员制（复用 `owner_id`）、管理员转让（直接生效）、社群内封禁/解封用户（踢出并禁入，支持 1/7/30 天或永久 + 原因）、编辑社群信息（简介/头像外链/公告）、管理员删本社群任意帖与评论、社群首页展示管理员、公开社群历史（创社/历代管理员/信息变更/治理记录） | 详见 [`p7-community-admin.md`](./p7-community-admin.md)；先完成核心业务权限闭环，原运维与压测后置至 P100 | `verify-p7.sh` **158 条断言全绿**（L0~L4，0 产品缺陷、线上零残留） |
| ✅ **P8 AI 社区助手（已完成）**（细化见 [`p8-ai-assistant.md`](./p8-ai-assistant.md)） | 独立 `ai-service`（WebClient 自研 Agent 循环、MySQL `kuaikan_ai` 会话 + SSE 流式输出）+ 前端全局 Copilot 抽屉与场景触发入口；覆盖站内找帖问答与跨帖总结、未读消息速览与回复建议、单帖省流、发帖/回复起草润色、受控代办执行（确认卡由前端执行，覆盖发帖/收藏/改昵称与头像/快捷关注与入群） | 依赖 P6 `/internal/search/posts` 与完整业务闭环；作为独立增值服务，不污染现有业务服务，不影响主站稳定性 | `verify-p8.sh` **48 条自动断言通过、0 失败、1 跳过**（未配 `DEEPSEEK_API_KEY` 跳过真实 LLM 冒烟）；L3 Playwright **13/13 通过**；L4 停 `ai-service` 主站零影响；线上零测试残留 |
| [**P9 向量知识库与个人权威档案（规划中）**](./p9-knowledge-base.md) | 详见 [`p9-knowledge-base.md`](./p9-knowledge-base.md)。本机 TEI（`bge-small-zh-v1.5`，512 维）+ 复用 ES 8.17 `dense_vector`/HNSW + 应用层 RRF；物理双索引（`post_chunk_v*` / `note_chunk_v*`）；三层知识体系（社区语义混合检索与帖子页「相关帖子」、明文全量注入的个人 AI 档案、Markdown 私密笔记与收藏/发帖语义检索）+ 三档检索范围切换 | 建立在 P8 AI 助手与 P6 内容事件流之上，补齐关键词检索盲区并实现“越用越懂你”的个性化问答、写作与帖子发现 | 语义查询可跨词召回且附来源标签（`社区帖子`/`我的笔记`/`我的收藏`/`我的帖子`）；个人权威档案优先级高于历史帖子且经确认卡入库；个人私密知识按 `ownerId` 硬隔离且删除/停用即刻零召回；TEI 停机不影响主站与 P6 搜索 |
| **P100 上线治理与压测（暂缓）** | 平台运维治理、SkyWalking + Prometheus + Grafana + Loki 可观测栈、JMeter 压测、Sentinel 限流规则、备份与恢复、镜像 tag 回滚演练 | 原 P7 非业务运维项统一后置，待业务主线全部完成后集中收口 | 全服务可观测、300 QPS 压测无错误、备份可恢复演练成功 |

## P2 细分

细化与契约见 [`p2-content.md`](./p2-content.md)。

| 子阶段 | 唯一引入的新概念 | 汇合验收 |
|---|---|---|
| ✅ **P2.0 契约闸门（已完成）** | 无业务代码 | 契约三方一致（19 码）+ OpenAPI 与白名单一致 |
| ✅ **P2.1 社群（已完成）** | 第一个新 schema | 游客可读社群详情；创建者是 owner 也是第一个成员；`verify-p2.sh` L2 17 条绿 |
| ✅ **P2.2 加入社群（已完成）** | 第一个跨表事务 + 第一个计数 | 加入 +1 / 幂等 / 退出 -1 / 再加入回到 +1 / **10 并发只 +1** |
| ✅ **P2.3 发帖（已完成）** | 第一个用户生成内容 + 第一个"谁有权限写" | 非成员 → `41004`；伪造 `X-User-Id` 无效；L4 证明读路径零跨服务依赖 |
| ✅ **P2.4 读路径（已完成）** | 第一个分页读路径 + 双栏布局 | 游客可浏览；翻页不重不漏；双栏/深链接/窄屏降级 |
| ✅ **P2.5 验收（已完成）** | — | `verify-p2.sh` 75 条全绿 |

## P5.5 细分

细化与契约见 [`p55-social.md`](./p55-social.md)。

| 子阶段 | 核心内容 | 汇合验收 |
|---|---|---|
| ✅ **P5.5.0 契约闸门（已完成）** | 新增 5 个错误码、`UserFollowed` 事件契约、网关 4 条游客白名单 | `check-contract.mjs` 全绿（26 码一致） |
| ✅ **P5.5.1 关注关系与 FOLLOW 消息（已完成）** | `user-service` `t_user_follow` + outbox；`notification-service` 与抽屉扩五类（24h 冷却） | 关注幂等、上限 `40211`、24h 冷却去重、抽屉跳 `/u/:id` |
| ✅ **P5.5.2 用户主页与关注流（已完成）** | `content` 按作者/多作者查帖、`community` 按用户查社群、完整 `/u/:userId` 与双栏 `/following`、帖子/评论作者入口 | 游客可读 `/u/:userId` 四 Tab；`/following` 读路径零跨服务调用 |
| ✅ **P5.5.3 `/me` 增强（改密 + 我的收藏）（已完成）** | `user` 改密码并全端踢下线、`interaction` 我的收藏分页、`content` 批量摘要、`/me` 页面整合 | 旧密码错 `200+40207`、改密全端失效、已删帖收藏可取消、P1 零回归 |
| ✅ **P5.5.4 验收（已完成）** | `verify-p55.sh` 分层验收 + 回写 `docs/project.md` | `verify-p55.sh` **105 条断言全绿**、工作区干净 |

## P8 细分

细化与契约见 [`p8-ai-assistant.md`](./p8-ai-assistant.md)。

| 子阶段 | 核心内容 | 汇合验收 |
|---|---|---|
| ✅ **P8.0 契约闸门 + spike（已完成）** | `ai-service` 骨架、`kuaikan_ai` schema、网关路由与 `X-AI-Stub` 剥头、nginx 关闭 buffering、44xxx 错误码、SSE 事件协议、WebClient 直连 DeepSeek 流式穿透到浏览器（最小 echo 对话） | T0 全绿（`check-contract` / `check-openapi`）；浏览器经 nginx → 网关 → `ai-service` 看到逐字流式出现；LLM 配错时其余页面零影响 |
| ✅ **P8.1 只读问答（已完成）** | 自研 Agent 循环 + 3 个只读工具 + 引用白名单 + 配额/流锁/熔断 + 会话持久化 + Copilot 抽屉 + 帖子页 AI 总结（共享缓存） | 问答附真实引用、伪造角标被剥离、第 6 步被截断、第 51 轮返回 `44001`、并发第二条流 `44002`、摘要缓存命中不扣配额 |
| ✅ **P8.2 创作与消息速览（已完成）** | `/compose` 内联帮写、`notification-service` 新增 `/internal` 未读读接口 + `list_unread_messages`、消息抽屉 AI 速览与预填回复 | 帮写只改草稿不产生任何服务端写；速览只含本人消息 |
| ✅ **P8.3 受控代办（已完成）** | `t_ai_action` + 6 类 `propose_*` + 确认卡交互与状态机 + 执行结果回传续写 | 未确认时数据库零写入；过期卡 `44005`；重复执行 `44006`；非成员发帖经确认卡后得到 `41004` 并被 AI 正确解读 |
| ✅ **P8.4 验收（已完成）** | `verify-p8.sh`（L0~L4：stub 确定性 + 真实冒烟 + L4 断 LLM 零连坐）+ 回写 `docs/project.md` | `verify-p8.sh` **48/48 通过**（1 跳过：`DEEPSEEK_API_KEY` 未配置），L3 **13/13 通过**，工作区干净、线上零测试残留 |

## P9 细分

细化与契约见 [`p9-knowledge-base.md`](./p9-knowledge-base.md)。

| 子阶段 | 核心内容 | 汇合验收 |
|---|---|---|
| ✅ **P9.0 契约闸门 + spike（已完成）** | 4 个新错误码（`44007~44010`，全站 36 → 40 码）、`kuaikan_note_changed` topic、网关 GET 白名单 `/api/search/posts/[^/]+/related$`、Compose 接入 `tei-embedding`（`cpu-1.8` + `bge-small-zh-v1.5`，`172.30.10.21`，`mem_limit: 1g`）、`post_chunk_v*`/`note_chunk_v*` mapping、`search-service` embedding 客户端与存量 56 篇全量回填、20 条评测集与相关帖阈值校准 | T0 全绿（`check-contract` / `check-openapi` / `check-scripts`）；TEI 健康（`183.3 MiB / 1 GiB`）；56 篇→60 切片回填完成（`12.6s`）；BM25（90%/0.704）vs 向量（100%/0.912）vs RRF（100%/0.925）对比结论及阈值 `0.78` 已回写 `docs/project.md` |
| **P9.1 社区语义与相关帖** | `post_chunk` 独立 MQ 消费组、`search_posts` 升级应用层 RRF 混合检索、`GET /api/search/posts/{id}/related`、帖子页正文与评论区之间懒加载「相关帖子」 | 跨词语义可召回并附 `[社区帖子]` 引用；帖子页最多 5 篇相关帖且低于阈值/停 TEI 时静默隐藏；停 TEI 后 P6 `/search` 与发帖照常 |
| **P9.2 个人 AI 档案** | `t_ai_profile_entry` + 档案 CRUD + 启用条目全量注入对话与帮写 system prompt + `propose_save_profile` / `SAVE_PROFILE_ENTRY` 确认卡 + `/me`「我的 AI 档案」UI | 档案优先级高于社区帖子；AI 提议未确认数据库零写入；停用不再注入；超 30 条返回 `44007` |
| **P9.3 私密笔记与我的知识库** | `t_ai_note` + `t_outbox` + `/internal/notes/**` + `note_chunk` 消费与重建 + `search_my_knowledge(NOTE\|FAVORITE\|MY_POST)` + 三档 `retrievalScope` + 引用来源标签 + `/me`「我的笔记」与 Copilot「存为笔记」 | 语义检索本人笔记/收藏/发帖附准确标签；`MY_ONLY` 零社区帖子召回；跨用户零越权；删/停用笔记即刻零召回 |
| **P9.4 验收** | `verify-p9.sh`（L0~L4 全链路）+ 回写 `docs/project.md` | 笔记跨用户零越权、删/停用不再被召回、停 TEI 主站与关键词搜索照常、未确认档案零写入；工作区干净、线上零残留 |

## P0.5 的边界

**只做"能让页面存在并拿到真实数据"的基础设施，不做任何业务页面。**

明确不做：登录页、注册页、帖子列表、帖子详情、任何调用 `/api/user/auth/**` 的代码、Zustand 里的用户态、业务组件。

验收物是一个**能显示后端真实数据的空壳**（把 `/test/` 的服务状态用 React 重写），不是任何产品功能。

### P0.5 同时确定的两件事

1. **后端加 `springdoc-openapi`**，前端类型由 `openapi-typescript` 从 spec 生成。
   一旦手写了第一个接口类型，后面会一直手写——"前端类型来自后端契约"必须在第一个业务接口之前建立。
2. **Token 存储方案**：access 放内存（Zustand），refresh 放 `httpOnly` + `Secure` + `SameSite=Lax` cookie。
   代价是 P0.5 的 HTTP 层要预留 `credentials: 'include'` 与"启动时静默续期"两个位置（先留空实现）。

## P1 细分（双泳道 + 汇合点）

细化与契约见 [`p1-auth.md`](./p1-auth.md)。

| 子阶段 | 后端 | 前端 | 汇合验收 |
|---|---|---|---|
| **P1.0 契约闸门** | 错误码枚举、端点冻结 | mock 基座、错误文案表 | 契约一致性脚本通过 |
| ✅ **P1.1 注册（已完成）** | Flyway 建表、验证码、BCrypt、注册开关 | 注册页、验证码倒计时、表单校验 | A：浏览器完成真实注册，库里是 BCrypt 哈希 |
| ✅ **P1.2 登录与会话（已完成）** | RSA + JWKS、签发、refresh 轮换、`/me`、`/sessions` | 登录页、会话层、路由守卫、bootstrap | B：刷新页面与重开浏览器都不掉登录态 |
| ✅ **P1.3 网关验签（已完成）** | GlobalFilter 验签 + 白名单 + 剥离注入 + `kuaikan-common-web` | 仅接线确认 | C：伪造 `X-User-Id` 无法冒充 |
| ✅ **P1.4 三种失效（已完成）** | 登出 / kick / ban 内部端点 | 登出、被封禁与踢下线提示 | D：三种失效均在浏览器可见 |
| ✅ **P1.5 验收（已完成）** | — | — | `verify-p1.sh` 全绿 |

**顺序不可颠倒**：P1.2 结束时网关是"透传态"，P1.3 才翻成"强制态"。先装守卫会导致登录接口自己被拦、一条链都测不了。

**从 P2 起每个阶段沿用这个模式**：契约闸门 → 双泳道 → 汇合验收。

## 分期开关

- **P3 是分水岭。** P3 的 outbox + 消费幂等 + 对账跑通，P4~P6 都只是"再消费一个事件"；若为跑通而在 P3 直接用同步调用改计数，后面每一层都会带着这个债。
- **P6 是最先该砍的**，砍它不影响任何其他部分。
- **P0 不许跳过。** 跳过它的代价是第 3 周同时面对 5 个互不兼容的组件。

## 一期明确不做

第三方登录、图片上传（先用外链）、举报与审核、编辑历史、私信、通知偏好设置、多语言、深色模式、移动端适配之外的响应式细节。

## P8 AI 社区助手功能概要

定位：**懂站内内容、感知当前页面上下文、且能在用户确认后动手执行的「社区副驾驶（Community Copilot）」**（详细方案见 [`p8-ai-assistant.md`](./p8-ai-assistant.md)）。

1. **信息提纯与问答（只读，免确认直出）**
   - 站内找帖问答与跨帖总结（复用 P6 `POST /internal/search/posts` + `includeBody=true`，强制附带可点击的站内帖子引用卡）
   - 未读消息与互动速览（总结待回复消息、给出候选回复思路，走 `notification-service` 内部接口）
   - 单帖与长评论区「省流」摘要
2. **创作与互动辅助（降发帖门槛）**
   - 发帖起草、Markdown 润色与目标社群推荐
   - 结合原帖与评论上下文的回复草拟
3. **受控代办执行（带用户权限，强制「确认卡 + 二次确认」）**
   - 确认后由前端以用户本人身份调用既有公开 API 执行，`ai-service` 不持有任何写通道
   - 对话式代发帖（展示目标社群、标题、正文预览卡，确认后发布）
   - 批量/顺手收藏与收藏夹内容检索整理
   - 对话式修改个人昵称、头像
   - 快捷关注作者 / 加入社群
4. **入口与安全底线**
   - 入口：全局右侧 Copilot 抽屉（自动携带当前路由上下文）+ 帖子页「AI 总结」、消息抽屉「AI 速览」、发帖框「AI 帮写」轻触点
   - 权限与风控：读写分级（只读直出，写操作强制确认卡，绝不静默代发）；严格继承登录用户本人权限（封禁/禁言/非成员照常拦截）；审计标记 + 按用户每日调用配额限流；LLM 故障零连坐主站

## P9 向量知识库与个人权威档案功能概要

定位：**为 P8 AI 助手接入语义级混合检索与透明可控的个人权威记忆，形成“公共知识自动沉淀 + 个人权威自主掌控 + 私有笔记/收藏精准召回”的三层知识体系**（完整技术方案、数据模型与接口契约见 [`p9-knowledge-base.md`](./p9-knowledge-base.md)）。

1. **向量基础设施与存储架构**
   - **Embedding**：本机自托管 TEI（CPU 镜像，`mem_limit: 1g`，内网 `172.30.10.21`）+ `BAAI/bge-small-zh-v1.5`（512 维），`search-service` 经 OpenAI 兼容 `/v1/embeddings` 协议接入。
   - **存储与混合检索**：复用既有 ES 8.17.4 + IK 8.17.4 原生 `dense_vector`（HNSW cosine）+ 应用层 RRF 融合（`k=60`）；物理拆分为公共切片索引 `post_chunk_v*` 与私密切片索引 `note_chunk_v*`（既有 `post_v*` 不动）。
2. **三层知识模型与核心场景**
   - **社区公共语义知识库（系统自动维护，全站共享）**：`search-service` 独立消费组对公开帖子按 Markdown 标题/段落切片向量化，升级 Copilot `search_posts` 为混合检索；新增 `GET /api/search/posts/{id}/related` 在帖子页正文与评论间懒加载展示最多 5 篇跨社群相关帖（不做发帖查重、不改公开 `/search` 页）。
   - **个人 AI 档案（用户主导维护，最高优先级，不走向量）**：`/me` 与 Copilot 确认卡支持明文条目（身份背景/技术与偏好/写作风格/其他，≤200 字/条，≤30 条/人），用户明示“记住…”或模型主动提议稳定偏好一律经 `SAVE_PROFILE_ENTRY` 确认卡入库；启用条目全量注入对话与帮写 system prompt。
   - **个人私密笔记与收藏/发帖知识库（`ownerId` 硬隔离，仅本人可见）**：`/me`「我的笔记」Markdown 编辑器与 Copilot 回答旁「存为笔记」写入 `kuaikan_ai`，经 `t_outbox` → `kuaikan_note_changed`（只传 ID）→ `search-service` 回查重切同步，并在读侧回查 MySQL 确保已删/停用条目零召回；新增 `search_my_knowledge(query, sources=[NOTE|FAVORITE|MY_POST])`。
3. **产品体验与隐私边界**
   - **检索范围切换**：抽屉提供 `全部` / `仅我的` / `仅当前社群` 三档切换，由后端通过工具挂载与过滤条件强约束。
   - **权威优先级与来源标签**：`① 个人 AI 档案 > ② 个人笔记与收藏 > ③ 社区公开帖子`，引用卡区分 `[社区帖子]` / `[我的笔记]` / `[我的收藏]` / `[我的帖子]`。
   - **降级隔离**：TEI 停机时 `search_posts` 自动退化为纯 BM25，相关帖子静默隐藏，P6 关键词搜索与主站完全不受影响。
