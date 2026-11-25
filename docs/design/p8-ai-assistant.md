# P8 AI 社区助手（Community Copilot）技术方案

> 状态：方案已评审（grill-me 2026-11-25），待 P8.0 启动。
> 架构不变量见 [`architecture.md`](./architecture.md)，版本与运行事实见 [`../project.md`](../project.md)。

---

## 1. 目标与边界

### 1.1 目标
打造**懂站内内容、感知当前页面、且能在用户确认后才动手的「社区副驾驶（Community Copilot）」**，作为独立增值服务落地，不影响既有主站核心链路。

按垂直切片分三期交付（外加前置 `P8.0` 契约闸门与结尾 `P8.4` 验收）：
1. **P8.1 只读问答与单帖省流**：打通 `ai-service` 骨架、SSE 流式穿透、Copilot 全局抽屉、站内找帖问答与跨帖总结（强制附带可信引用卡）、帖子页「AI 总结 / 省流」（带版本化共享缓存）。
2. **P8.2 创作与消息速览**：发帖框/评论框编辑器内联「AI 帮写」（扩写 / 润色 / 精简 / 推荐社群 / 上下文回复）与消息抽屉「AI 速览」（总结待回复消息 + 预填候选回复）。
3. **P8.3 受控代办写操作**：对话式提出 6 类动作（发帖 / 批量收藏 / 关注作者 / 加入社群 / 改昵称 / 改头像外链），经确认卡二次确认后由前端以本人身份调用既有公开 API 执行并回传结果续写。

### 1.2 明确不做（本期边界）
- 向量检索、BM25+向量混合检索、个人权威档案与私密笔记（归 **P9**）。
- 游客直接对话或使用帮写（游客可见入口，点击引导登录）。
- 为代发成功的帖子追加「AI 生成」标签（内容归用户本人负责）。
- 内容自动审核或替代人工/社群管理员治理。

---

## 2. 关键决策表

| # | 决策 | 理由 |
|---|---|---|
| D1 LLM | 接入 **DeepSeek**（`deepseek-chat`），代码只依赖 OpenAI 兼容 Chat Completions 协议（流式 + `tools`）；`kuaikan.ai.base-url` / `model` / `api-key` 全配置化，换供应商只改配置；`api-key` 走服务器环境变量（`DEEPSEEK_API_KEY`），不进 git | 中文社区理解能力强、原生支持 Tool Calling 与流式、成本可控；接口协议解耦避免厂商锁定 |
| D2 技术栈 | 独立 `ai-service`（Java 21 + Spring Boot 3.5.16，注册 Nacos，端口 `8088`）。**不使用 Spring AI / LangChain4j**：使用 `WebClient` 手写直调 OpenAI 兼容接口，**完全自研 Agent 循环**。Servlet 栈（复用 `kuaikan-common-web` 的 `UserContextFilter`）+ `SseEmitter` 下发；仅为 `WebClient` 引入 webflux 依赖；开启虚拟线程；工具调用下游服务使用 OpenFeign | 避免抽象框架黑盒与版本矩阵冲突，精确控制工具步数、进度事件推送、身份注入及写动作截断；与全站技术栈保持一致 |
| D3 写操作通道 | **ai-service 永不执行写**。写工具只产出结构化「动作提议」推给前端渲染确认卡；用户确认后由前端用本人 access token 调用既有公开 API（与手动点击按钮同一路径），再把执行结果回传给 AI | 业务服务零改动、用户权限/封禁/非成员/网关验签天然继承、物理上不可能静默代发、消除 prompt 注入导致的越权写风险 |
| D4 私有数据读取 | 读私有数据（未读消息、我的收藏、我加入的社群）一律走目标服务 `/internal/**` 接口，**`userId` 由 `ai-service` 从 `UserContext` 注入，绝不由模型参数提供**，也不伪造 `X-User-Id` 调公开接口 | 防止模型参数幻觉或 prompt 注入跨用户越权读取，坚守网关单一验签信任源 |
| D5 会话存储 | MySQL 新 schema `kuaikan_ai`（按 ADR 0006 建独立受限账号），后端持有对话真相，不信任前端回传历史；会话保留 30 天并定时清理；送入模型的上下文窗口只取最近 10 轮 | 确认卡「提议 → 确认 → 回传」是跨请求状态机，须由后端持久化与校验防篡改；同时控制窗口成本并为 P9 留底 |
| D6 引用防编造 | 工具返回给模型的每篇帖子带本轮编号 `[n]`；模型正文只允许写角标 `[^n]`，**禁止输出 URL**；后端维护「本轮工具真实取回的 `postId` 白名单」，流末推 `citations` 事件（标题/社群名/作者均来自工具真实结果）；前端仅将白名单内角标渲染为可点引用卡，非法角标直接剥离；检索为空时要求明说「站内没找到」 | 从协议层消除编造帖子或伪造链接的可能，满足站内问答引用可信的验收硬标准 |
| D7 配额与熔断 | Redis 按日计数：每人每天 **50 轮**（一次发送 = 一轮）、单轮 Agent 最多 **5 步**工具（超限强制 `tool_choice=none` 收尾）+ `max_tokens` 上限、**全站每日 token 总预算熔断**（默认 500 万，超限当日 AI 整体返回 `44003`）、每人同时仅允许 **1 条进行中的流**（Redis 锁）。阈值全部可配置 | 轮次配额用户心智最清晰；步数与 `max_tokens` 防止工具死循环；总预算熔断与并发锁兜底成本与防刷 |
| D8 单帖省流 | 帖子页点「AI 总结」→ 打开 Copilot 抽屉，以预设意图 `SUMMARIZE_POST + postId` 新开会话，可继续追问；首条摘要按 `postId + commentCount` 做 Redis 全站共享缓存（TTL 24h），命中直接返回，不扣配额、不消耗 token | 既支持用户在抽屉内继续追问，又让热门帖子评论未变时实现秒出且零模型开销，公开内容共享无隐私问题 |
| D9 帮写形态 | 发帖框/评论框旁「AI 帮写」走**编辑器内联**：支持扩写 / 润色 / 精简 / 推荐社群（及回复场景）；预览面板流式出字，用户选「替换 / 插入 / 放弃」，仅改本地草稿，发布仍手动，**不需要确认卡**；走无会话 `/compose` 并扣配额。消息速览的候选回复点「去回复」跳对应评论并预填评论框，不自动发送 | 降低发帖与回复门槛的同时保持零破坏性，避免无谓拉重确认卡交互 |
| D10 确认卡 | 覆盖 6 类动作：发帖 / 收藏（可批量）/ 关注作者 / 加入社群 / 改昵称 / 改头像外链。**发帖卡可编辑**（社群下拉 / 标题 / 正文），**批量收藏卡可逐条取消勾选**，其余只读展示前后对比；状态机 `PROPOSED → EXECUTED / FAILED / REJECTED / EXPIRED`，30 分钟过期，一卡一次性（后端按状态幂等）；结果回传后 AI 续一句（不扣配额，如 `41004` 时建议先入群）；卡片标注「AI 提议」，成功发布的帖子不加 AI 标记 | 兼顾起草微调灵活性与执行期确定性；一卡一状态机防重放与过期执行 |
| D11 入口布局 | 顶栏「AI」按钮 + `Ctrl/⌘ + J` 打开**右侧浮层抽屉**（约 420px，极光琉璃风格，不挤压主内容），与消息抽屉**互斥**；顶部：新对话 / 历史会话 / 今日剩余次数；输入框上方显示「当前页面：《xxx》」上下文标签（可叉掉）；切路由保持打开且对话不丢；窄屏全屏；底部提示「对话内容会发送至第三方模型服务」 | 与现有消息抽屉保持一致交互与视觉体系，避免双抽屉叠层冲突，明确告知数据流向 |
| D12 验证 | LLM 客户端抽象为接口，内置 Stub 实现：仅当 `kuaikan.ai.stub-enabled=true` 且请求带 `X-AI-Stub: <场景名>` 时生效；**网关强制剥离 `X-AI-Stub`**，使 stub 只能从容器网络内直连 `ai-service` 触发（L2）。确定性断言走 stub，另加 2~3 条真实 DeepSeek 冒烟（只断言有 `delta` / `done` / 引用合法）；L3 浏览器层走真实 LLM 只做结构断言；L4 配错 `base-url` 断言主站零影响 | 剥离模型输出随机性带来的假红，同时保证真实公网链路与故障降级均得到实测 |
| D13 故障隔离 | `ai-service` 独立容器（`mem_limit: 512m`），无任何既有业务服务依赖它；前端 AI 组件懒加载，**主站首屏零 AI 请求**（配额仅在打开抽屉时拉取）；LLM 超时或出错只在抽屉内以 `error` 事件呈现 | 保证主站首屏性能与「LLM 不可用时主站零影响」架构底线 |

---

## 3. 契约变更（P8.0 闸门）

### 3.1 新增错误码（44xxx 段，30 → 36 码）
统一登记至 `contract/error-codes.json`，同步 Java 枚举 `AiErrorCode`（位于 `kuaikan-common`）与 `ErrorHttpStatus` 映射，执行 `npm run gen:contract` 生成 `web/src/shared/api/error-codes.gen.ts`（具体码数以落地时 `check-contract.mjs` 为准）：

| 码 | 名称 | HTTP | owner | 默认文案 | 使用场景 |
|---|---|---|---|---|---|
| `44001` | `AI_QUOTA_EXCEEDED` | 429 | `ai` | 今日 AI 对话次数已用完 | 单用户日调用轮次耗尽 |
| `44002` | `AI_STREAM_BUSY` | 409 | `ai` | 已有正在进行的回答，请稍候 | 用户并发发起第二条 SSE 流 |
| `44003` | `AI_UNAVAILABLE` | 503 | `ai` | AI 服务暂时不可用 | LLM 上游故障/超时或全站每日 token 预算熔断 |
| `44004` | `AI_CONVERSATION_NOT_FOUND` | 404 | `ai` | 对话不存在或无权访问 | 访问/删除不存在或非本人的会话 |
| `44005` | `AI_ACTION_EXPIRED` | 200 | `ai` | 该操作提议已过期，请重新发起 | 确认卡超过 30 分钟有效期后回传或执行 |
| `44006` | `AI_ACTION_STATE_INVALID` | 409 | `ai` | 操作提议状态不允许此操作 | 重复回传或对非 `PROPOSED` 状态卡片提交结果 |

### 3.2 网关路由与请求头剥离（`services/gateway/src/main/resources/application.yml`）
- 新增路由 `id: ai-service`，`uri: lb://ai-service`，`predicates: Path=/api/ai/**`，`filters: StripPrefix=2`（`ai-service` Controller 映射路径**不带** `/api/ai` 前缀，避免踩 P4.2/P5.2 的双前缀坑）。
- **无白名单**：`/api/ai/**` 全部经过网关 JWT + Redis 白名单强制鉴权，未登录一律 `401`。
- **剥离 `X-AI-Stub`**：无论放行或鉴权路径，网关转发前强制 remove `X-AI-Stub` 请求头，禁止从公网触发 Stub LLM。

### 3.3 Nginx 配置（`deploy/nginx/kuaikan.conf`）
在全部 3 个 `server` 块中仿照 `/api/notification/stream` 新增 `location /api/ai/`：
- `proxy_buffering off;`（严禁缓冲 SSE 分片）
- `proxy_read_timeout 300s;`（大于单轮 90s 超时与 15s 心跳周期）

### 3.4 Compose、Schema 与环境变量
- `compose`（`app` profile）新增 `ai-service` 容器（容器内端口 `8088`，`mem_limit: 512m`）。
- MySQL 新增 schema `kuaikan_ai` 及独立受限账号（遵循 ADR 0006）。
- 服务器运行环境新增 `DEEPSEEK_API_KEY`（不进 git）；`kuaikan.ai.stub-enabled` 等配置通过环境或配置管理注入。

---

## 4. 接口契约（`ai-service`，网关对外前缀 `/api/ai`）

> 所有雪花 ID 字段必须标注 `@Schema(type = "string")`，与 `kuaikan-common-web` 全局 `Long→String` 序列化对齐。以下路径为经过网关 `StripPrefix=2` 前的外部路径。

| 方法 | 外部路径 | 说明 | 所属子阶段 |
|---|---|---|---|
| `POST` | `/api/ai/conversations` | 新建空会话（返回会话 ID、默认标题、创建时间） | P8.0 / P8.1 |
| `GET` | `/api/ai/conversations?cursor=&limit=` | 当前用户的历史会话列表（按 `updated_at DESC, id DESC` 游标分页） | P8.1 |
| `GET` | `/api/ai/conversations/{id}/messages?cursor=&limit=` | 查询会话历史消息（校验 `user_id` 归属，非本人或不存在返 `44004`） | P8.1 |
| `DELETE` | `/api/ai/conversations/{id}` | 删除会话（校验归属，非本人或不存在返 `44004`） | P8.1 |
| `POST` | `/api/ai/conversations/{id}/messages` | 发送消息并流式返回（`produces = text/event-stream`） | P8.0 / P8.1 |
| `GET` | `/api/ai/quota` | 查询当前用户今日已用与剩余对话轮数 | P8.1 |
| `POST` | `/api/ai/compose` | 编辑器内联帮写（`produces = text/event-stream`，无会话持久化，扣配额） | P8.2 |
| `POST` | `/api/ai/actions/{id}/result` | 回传确认卡前端执行结果，AI 续写一句（`produces = text/event-stream`，不扣配额） | P8.3 |

### 关键请求体约束
- `POST /api/ai/conversations/{id}/messages`：
  ```json
  {
    "content": "这篇帖子的核心结论是什么？",
    "intent": "SUMMARIZE_POST",
    "pageContext": {
      "type": "POST",
      "postId": "2120067985624219650",
      "communityName": "tech",
      "userId": null
    }
  }
  ```
  - `intent` 可选（如 `"SUMMARIZE_POST"`）；`pageContext.type` 枚举：`POST | COMMUNITY | HOME | SEARCH | USER | OTHER`。
  - **硬约束**：`pageContext` **只收 ID / 名称标识，不收任何前端文本**；后端仅将「当前页面: 帖子 `postId=...`」作为定位提示注入上下文，模型需要具体正文/评论时须自行调工具获取。
- `POST /api/ai/compose`（P8.2）：
  `{ "mode": "EXPAND | POLISH | SHORTEN | RECOMMEND_COMMUNITY | REPLY", "draft": "...", "postId": "...", "commentId": "..." }`
- `POST /api/ai/actions/{id}/result`（P8.3）：
  `{ "status": "EXECUTED | FAILED | REJECTED", "resultRef": "...", "errorCode": 41004 }`

> 前端请求约定：所有 SSE 端点统一沿用 `web/src/features/notification/api.ts` 的 `fetch + res.body.getReader()` 解析（原生 `EventSource` 不支持 `POST` 与鉴权头）。

---

## 5. SSE 事件协议

每条服务端推送事件按标准 SSE `event:` + `data:` 格式输出，每 15 秒发送一条注释心跳（`: ping\n\n`）保活。

典型一轮对话的事件序列：
1. `meta`：`{"conversationId":"...","messageId":"...","quotaRemaining":49}`
2. 若干 `tool_status`：`{"tool":"search_posts","phase":"start|end","label":"正在搜索站内帖子…"}`
3. 若干 `delta`：`{"text":"..."}`
4. `citations`：`[{"n":1,"postId":"...","title":"...","communityName":"...","authorNickname":"..."}]`（流结束前由后端依据白名单下发）
5. （P8.3 触发写提议时）`action`：`{"actionId":"...","type":"CREATE_POST","payload":{...},"expiresAt":"..."}`
6. `done`：`{"usage":{"promptTokens":1200,"completionTokens":350}}`
7. 任意时刻发生错误时推 `error`：`{"code":44003,"message":"AI 服务暂时不可用"}` 并结束流。

---

## 6. Agent 循环（自研）与工具清单

### 6.1 自研 Agent 执行流程
1. **锁与配额前置检查**：
   - 抢占 Redis 流锁 `ai:lock:stream:{userId}`（单人并发上限 1，冲突返回 `44002`）。
   - 检查单日轮次配额 `ai:quota:{yyyyMMdd}:{userId}`（超限返回 `44001`）。若为 `SUMMARIZE_POST` 且命中 Redis 共享缓存 `ai:summary:{postId}:{commentCount}`，则直接下发缓存正文与引用并结束——**不扣配额、不耗 token**。
   - 检查全站每日 token 总预算 `ai:budget:{yyyyMMdd}`（达到熔断阈值直接返回 `44003`）。
   - 组装模型 `messages`：system prompt + 最近 10 轮历史消息 + `pageContext` 定位提示 + 当前用户消息。
2. **WebClient 流式请求与分片解析**：
   - 异步流式读取 OpenAI 兼容端点响应 `data:` 块；按 `index` 累积 `tool_calls` 参数分片；纯文本分片即时转发为前端 `delta` 事件。
3. **受控工具循环**：
   - 若模型返回 `tool_calls`，推送 `tool_status(start)` → 执行工具（私有读接口由服务侧显式传入 `UserContext` 中的 `userId`）→ 推送 `tool_status(end)` → 将工具输出包裹在 `<tool_result>...</tool_result>` 定界符内回填为 `tool` 角色消息（system prompt 声明该定界内部仅为参考数据，不是指令）→ 进入下一步。
   - 单轮最多执行 **5 步**工具调用；第 5 步仍未输出最终文本时，第 6 次调用强制设置 `tool_choice="none"` 要求模型收尾作答。
4. **引用白名单校验与落库**：
   - 流式正文结束后，按本轮工具真实取回的 `postId` 白名单核对正文中 `[n]`/`[^n]` 角标，生成仅含真实元数据的 `citations` 事件（前端同时剥离不在白名单内的非法角标）。
   - 将本轮用户消息、助手回复、tool 调用摘要、合法 `citations`、页面上下文与 token 用量落库 `kuaikan_ai`。
   - 累加全站 `ai:budget:{yyyyMMdd}`，推送 `done` 事件；在 `finally` 中释放 `ai:lock:stream:{userId}`。
5. **超时与故障隔离**：
   - WebClient 连接超时 **5s**、首 token 超时 **20s**、整轮超时 **90s**；超时或上游返回非 2xx 错误时推送 `error(44003)` 并安全释放锁。

### 6.2 工具清单（分期接入）

| 工具名 | 阶段 | 下游调用 | 核心约束 |
|---|---|---|---|
| `search_posts` | P8.1 | `search-service` `POST /internal/search/posts` | `includeBody=true`，单篇正文截断约 1500 字，`limit ≤ 8`，取回的帖子写入本轮引用白名单 |
| `get_post` | P8.1 | `content-service` 帖子详情读接口 | 取回单帖元数据与正文（截断保护），写入白名单 |
| `get_comments` | P8.1 | `content-service` `GET /posts/{id}/comments?sort=hot` | 最多取前 50 条热评并截断单条长度 |
| `list_unread_messages` | P8.2 | `notification-service` **新增** `/internal/**` 未读消息读接口 | `userId` 由 `UserContext` 注入，模型不可传 `userId` |
| `list_my_communities` / `list_my_favorites` | P8.3 | `community-service` / `interaction-service` `/internal/**` | 显式注入当前 `userId`（缺 `/internal` 读接口则补齐） |
| `propose_*`（6 类写提议） | P8.3 | 不调业务服务，仅写 `t_ai_action` | 覆盖发帖 / 批量收藏 / 关注作者 / 加入社群 / 改昵称 / 改头像外链；仅落提议并推 `action` 事件 |

---

## 7. 数据模型（`kuaikan_ai`，Flyway）与 Redis 设计

### 7.1 `V1__ai_conversation_and_message.sql`
- **`t_ai_conversation`**：
  `id BIGINT UNSIGNED PK`（雪花）、`user_id BIGINT UNSIGNED NOT NULL`、`title VARCHAR(100) NOT NULL`、`status TINYINT NOT NULL DEFAULT 1`、`created_at DATETIME(3)`、`updated_at DATETIME(3)`；索引 `idx_user_updated (user_id, updated_at DESC, id DESC)`。
- **`t_ai_message`**：
  `id BIGINT UNSIGNED PK`、`conversation_id BIGINT UNSIGNED NOT NULL`、`user_id BIGINT UNSIGNED NOT NULL`、`role ENUM('user','assistant','tool') NOT NULL`、`content MEDIUMTEXT NULL`、`tool_calls JSON NULL`、`tool_call_id VARCHAR(64) NULL`、`citations JSON NULL`、`page_context JSON NULL`、`prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0`、`completion_tokens INT UNSIGNED NOT NULL DEFAULT 0`、`created_at DATETIME(3)`；索引 `idx_conv_id (conversation_id, id ASC)`。

### 7.2 `V2__ai_action.sql`（P8.3）
- **`t_ai_action`**：
  `id BIGINT UNSIGNED PK`、`conversation_id BIGINT UNSIGNED NOT NULL`、`message_id BIGINT UNSIGNED NOT NULL`、`user_id BIGINT UNSIGNED NOT NULL`、`type VARCHAR(32) NOT NULL`、`payload JSON NOT NULL`、`status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' COMMENT 'PROPOSED|EXECUTED|FAILED|REJECTED|EXPIRED'`、`result JSON NULL`、`expires_at DATETIME(3) NOT NULL`、`created_at DATETIME(3)`、`updated_at DATETIME(3)`；索引 `idx_user_status (user_id, status, created_at DESC)`。

### 7.3 清理与 Redis 键
- **定时清理**：每日定时任务清理 30 天前会话及其关联消息/动作记录。
- **Redis 键**：
  - `ai:quota:{yyyyMMdd}:{userId}`：用户当日已用轮数（TTL 48h）
  - `ai:budget:{yyyyMMdd}`：全站当日已耗 token 总量（TTL 48h）
  - `ai:lock:stream:{userId}`：单人流并发锁（带兜底 TTL 防进程异常死锁，正常结束 `finally` 立即删除）
  - `ai:summary:{postId}:{commentCount}`：单帖省流首条摘要全站共享缓存（TTL 24h）

---

## 8. 前端设计

- **Copilot 抽屉（D11）**：顶栏新增「AI」入口按钮（游客点击引导登录）并支持 `Ctrl/⌘ + J`；右侧浮层抽屉约 420px（极光琉璃风格，与消息抽屉互斥，路由切换保持状态），窄屏自适应全屏。顶部提供新对话 / 历史会话切换 / 今日剩余次数；输入框上方显示「当前页面：《xxx》」可关闭上下文标签；底部固定提示「对话内容会发送至第三方模型服务」。
- **引用卡（D6）**：回答正文仅对后端 `citations` 白名单内的 `[^n]` 渲染内联角标，未命中角标直接剥离；回答末尾展开可点击站内帖子引用卡（跳 `/c/{communityName}/p/{postId}`）。
- **帖子页「AI 总结」（D8）**：点击唤起抽屉并自动带入 `SUMMARIZE_POST` 意图，支持直接追问。
- **编辑器内联帮写（D9，P8.2）**：发帖框与评论框旁「AI 帮写」提供扩写 / 润色 / 精简 / 推荐社群（及回复）快捷意图，流式预览后支持「替换 / 插入 / 放弃」填入草稿。
- **消息抽屉「AI 速览」（P8.2）**：汇总未读待回复消息，提供候选回复，点击「去回复」跳转到对应评论并预填评论框。
- **确认卡（D10，P8.3）**：卡片统一标注「AI 提议」；发帖卡支持编辑社群/标题/正文，批量收藏卡支持取消勾选，其余动作只读展示前后对比；用户点确认后由前端用本人 token 调既有公开 API 并把结果回传 `/api/ai/actions/{id}/result`。
- **隔离与 `data-testid`**：所有 AI UI 组件通过懒加载按需引入，**主站首屏不发任何 AI 请求**；新增元素在对应子阶段任务单中明确标注清晰 `data-testid`。

---

## 9. 安全与风险

- **Prompt 注入**：外部工具返回均包在 `<tool_result>` 定界符中且提示词明示其不可信；所有写能力仅通过结构化提议渲染前端确认卡，确认卡点击是不可绕过的最终物理防线。
- **越权防护**：会话/消息/动作接口严格校验 `user_id == UserContext.userId`；所有私有读工具的 `userId` 只从服务端 `UserContext` 注入。
- **成本失控**：单用户日 50 轮 + 单轮 5 步 + `max_tokens` + 并发流锁 + 全站 500 万 token 日熔断 + 单帖摘要共享缓存六重兜底。
- **隐私合规**：抽屉明确告知内容会发往第三方模型服务；私密消息原文与用户提示词禁止完整写入后端日志。

---

## 10. 分阶段交付与验证计划

沿用项目「**契约闸门 → 双泳道 → 汇合验收**」节奏推进：

| 子阶段 | 内容 | 汇合验收 |
|---|---|---|
| **P8.0 契约闸门 + spike** | `ai-service` 骨架、`kuaikan_ai` schema、网关路由与 `X-AI-Stub` 剥头、nginx 关闭 buffering、44xxx 错误码契约、SSE 事件协议、WebClient 直连 DeepSeek 流式穿透到浏览器（最小 echo 对话） | T0 全绿（`check-contract` / `check-openapi`）；浏览器经 nginx → 网关 → `ai-service` 看到逐字流式出现；LLM 配错时主站其余页面零影响 |
| **P8.1 只读问答** | 自研 Agent 循环 + 3 个只读工具 + 引用白名单 + 配额/流锁/熔断 + 会话持久化 + Copilot 抽屉 + 帖子页 AI 总结（共享缓存） | 问答附真实引用、伪造角标被剥离、第 6 步被截断、第 51 轮返回 `44001`、并发第二条流 `44002`、摘要缓存命中不扣配额 |
| **P8.2 创作与消息速览** | `/compose` 内联帮写、`notification-service` 新增 `/internal` 未读读接口 + `list_unread_messages`、消息抽屉 AI 速览与预填回复 | 帮写只改本地草稿不产生任何服务端写；速览严格只含本人消息 |
| **P8.3 受控代办** | `t_ai_action` + 6 类 `propose_*` + 确认卡交互与状态机 + 执行结果回传续写 | 未确认时数据库零写入；过期卡 `44005`；重复提交 `44006`；非成员发帖经确认卡后得到 `41004` 并被 AI 正确解读 |
| **P8.4 验收** | `verify-p8.sh`（L0~L4：stub 确定性 + 真实冒烟 + L4 断 LLM 零连坐）+ 回写 `docs/project.md` | 全绿、工作区干净、线上零测试残留 |
