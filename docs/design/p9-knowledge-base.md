# P9 向量知识库与个人权威档案技术方案

> 状态：方案已评审待实施（2026-11-26）。
> 架构不变量见 [`architecture.md`](./architecture.md)，版本与运行事实见 [`../project.md`](../project.md)，前置 AI 助手设计见 [`p8-ai-assistant.md`](./p8-ai-assistant.md)。

---

## 1. 目标与边界

### 1.1 目标
为 P8 社区副驾驶（Community Copilot）接入**语义级混合检索**与**透明可控的个人权威记忆**，形成「社区公共语义沉淀 + 个人权威自主掌控 + 私有笔记/收藏精准召回」的三层知识体系，同时为帖子详情页补齐跨社群「相关帖子」发现能力。

按垂直切片分五期推进（`P9.0` ~ `P9.4`）：
1. **Copilot 语义问答（`search_posts` 升级）**：内部升级为 **BM25 + 向量混合检索（应用层 RRF）**，补齐近义词与跨词描述召回盲区；支持抽屉内三档检索范围切换（`全部` / `仅我的` / `仅当前社群`）。
2. **帖子页「相关帖子」**：正文与评论区之间展示最多 **5 篇**跨社群相关帖（排除本帖、游客可见、低于相似度阈值隐藏、基于本帖既有向量做 kNN，不实时调用 Embedding 服务）。
3. **个人 AI 档案（最高权威优先级）**：明文条目化管理（身份背景 / 技术与偏好 / 写作风格 / 其他，单条 ≤ 200 字，每人 ≤ 30 条），**不走向量检索**，启用条目全量注入对话与帮写 system prompt；支持用户明确说“记住…”及模型主动识别稳定偏好（每轮最多 1 条），一律走 `SAVE_PROFILE_ENTRY` 确认卡闭环入库。
4. **个人 Markdown 私密笔记知识库**：`/me`「我的笔记」列表与 Markdown 编辑/预览 + Copilot 回答旁「存为笔记」快捷按钮（单篇 ≤ 2 万字，每人 ≤ 200 篇，支持停用与硬删除），按段切片向量化存入独立私密索引，按 `ownerId` 硬隔离。
5. **「我的收藏 / 我发过的帖」语义检索**：新增 `search_my_knowledge(query, sources=[NOTE|FAVORITE|MY_POST])` 工具，支撑“查我收藏过的资料”“按我过往发帖查思路”等场景，引用卡按来源展示对应标签。

### 1.2 明确不做（本期边界）
- **不做发帖查重 / 「可能已有人讨论过」**：生活经历大同小异，不因他人发过相似话题而劝阻用户发布。
- **不做公开 `/search` 页混合检索**：公开搜索页保持 P6 纯 BM25 检索，避免游客公网请求实时冲击 Embedding 容器。
- **不做评论区切片入库**：P9 仅对帖子与私密笔记切片建向量，热评仍通过 P8 `get_comments` 工具按需读取。
- **不用向量替换 P8 的 LLM 推荐社群**：帮写「推荐社群」沿用既有能力，不在本期改动。
- **不做 AI 主动提议保存笔记**：不新增 `propose_save_note` 确认卡，笔记仅由用户在 `/me` 手写或主动点击回答旁「存为笔记」创建。

---

## 2. 关键决策表

| # | 决策 | 理由 |
|---|---|---|
| D1 Embedding | 本机自托管 **TEI（Text Embeddings Inference，CPU 镜像）** 容器 + **`BAAI/bge-small-zh-v1.5`**（512 维），归入 `core` profile，固定内网 IP `172.30.10.21`，**无宿主机端口**，`mem_limit: 1g`。`search-service` 仅依赖 OpenAI 兼容 `/v1/embeddings` 协议，`kuaikan.embedding.*` 全配置化 | 约 400 MB 内存适配当前 15 GiB 服务器余量，CPU 单条约 10~30ms；无需外部 API key 即可在离线/验收环境下稳定运行；私密笔记向量化不出服务器；协议解耦使日后切换云端只改配置 |
| D2 向量存储与混合检索 | 复用既有 **Elasticsearch 8.17.4 + IK 8.17.4** 原生 `dense_vector`（512 维、`similarity: cosine`、HNSW）+ IK BM25。**应用层自写 RRF（Reciprocal Rank Fusion，`k = 60`）** | ES 8.17 内置 `rrf` retriever 属于付费商业订阅能力，Basic 免费版不可用；复用 ES 避免引入 Qdrant 带来的额外容器运维与跨库删帖一致性成本，可直接使用 P6 别名与零停机重建机制 |
| D3 物理双索引与切片 | 物理拆分为两个独立切片索引：**`post_chunk_v{ts}`**（公共，别名 `post_chunk_read`/`post_chunk_write`）与 **`note_chunk_v{ts}`**（私密，别名 `note_chunk_read`/`note_chunk_write`）；既有 `post_v*` 保持不动。切片策略：按 Markdown 标题与段落切分，约 **400 字/片**、相邻重叠 **80 字**，每片文本前拼接 `标题：{title}\n`；检索归并时同一 `postId` / `noteId` 仅保留得分最高的一片 | 公共检索链路物理上碰不到 `note_chunk_*`，杜绝漏加过滤条件导致的跨用户泄露；公共索引重建不波及私密笔记；以 `postId` 归并使返回结果天然兼容 P8 引用白名单与卡片形态 |
| D4 服务归属与同步 | **`ai-service` 持有档案与笔记的 MySQL 真相**（`kuaikan_ai`），笔记变更同事务写 `t_outbox` 发送 `kuaikan_note_changed`（**载荷仅含 `noteId` 与 `ownerId`，不放正文**）。**`search-service` 是全站唯一 ES 客户端与唯一 TEI 调用方**：<br>① 帖子向量使用**独立消费组**消费 `kuaikan_post_created` / `kuaikan_post_deleted`；<br>② 笔记消费组收到 `kuaikan_note_changed` 后回查 `ai-service` `GET /internal/notes/{noteId}`：存在且启用则全量重切写入，不存在或停用则按 `noteId` 删除；<br>③ **读侧强一致兜底**：`ai-service` 拿到 `note_chunk` 召回后回查 MySQL 过滤已删除或已停用条目；<br>④ 扩展 `POST /internal/admin/rebuild` 支持重建 `post_chunk` / `note_chunk` | 严格遵守 P6 建立的读侧投影边界；独立消费组保证 TEI 故障时 P6 关键词索引零阻塞；MQ 不落私密正文且天然防乱序；读侧回查 MySQL 消除异步 1 秒窗口内的“已删/停用仍被召回”风险 |
| D5 Agent 触发与工具 | 沿用 P8 **工具驱动**（单轮最多 5 步）。`search_posts` 工具名与入参不变，内部升级为混合检索；新增 **`search_my_knowledge(query, sources=[NOTE\|FAVORITE\|MY_POST])`**，`userId` 由 `ai-service` 从 `UserContext` 注入：<br>• `NOTE`：查 `search-service` `/internal/search/notes`（强制 `ownerId`）+ MySQL 复核；<br>• `MY_POST`：查 `post_chunk_read` + `authorId = currentUserId`；<br>• `FAVORITE`：先查 `interaction-service` `/internal` 收藏 `postId` 列表，再带 `postIds` 在 `post_chunk_read` 内混合检索。<br>个人档案不走工具，启用条目全量注入对话与帮写 system prompt，上下文冲突优先级：`① 个人权威档案 > ② 个人笔记与收藏 > ③ 社区公开帖子` | 不在「改昵称」等简单对话中浪费额外检索与 token；私有数据源严格从 `UserContext` 取身份防模型参数越权 |
| D6 检索范围切换 | `SendMessageRequest` 新增可选字段 `retrievalScope`（`ALL \| MY_ONLY \| CURRENT_COMMUNITY`，默认 `ALL`，不跨刷新持久化），由后端强约束：`MY_ONLY` 时仅向模型挂载 `search_my_knowledge`；`CURRENT_COMMUNITY` 时由后端从 `pageContext` 提取 `communityId` 强制注入 `search_posts` 过滤条件（非社群页前端该档置灰）；`ALL` 时两工具均挂载 | 将范围隔离权留在后端代码层而非依赖提示词软约束，确保「仅我的」不会意外召回社区帖子 |
| D7 引用与来源标签 | `CitationItem` 新增 `sourceType`（`POST \| NOTE \| FAVORITE \| MY_POST`）与可选 `noteId`（帖子类填 `postId`，笔记类填 `noteId`）。后端引用白名单同步校验 `postId` 与 `noteId`；前端引用卡分别渲染 `[社区帖子]` / `[我的笔记]` / `[我的收藏]` / `[我的帖子]` 标签 | 让用户清晰辨别每条结论出自个人权威笔记、收藏资料还是社区公开讨论，防止来源混淆 |
| D8 个人档案确认卡 | 复用 P8 `t_ai_action` 状态机，新增动作类型 `SAVE_PROFILE_ENTRY` 与工具 `propose_save_profile`；支持用户明示“记住…”及模型识别到稳定偏好时主动提议（单轮最多 1 条）。用户点击确认后，前端以本人 JWT 调用 `POST /api/ai/profile/entries` 写入并向 `/api/ai/actions/{id}/result` 回传执行结果 | 保持 P8「AI 永不静默写用户真相」的物理防线，避免模型幻觉污染长期记忆 |
| D9 相关帖子 | 对外提供 `GET /api/search/posts/{postId}/related?limit=5`（加入网关 GET 放行白名单，游客可读）。`search-service` 用该帖在 `post_chunk_read` 中已有切片的向量执行 kNN 召回（**不调用 TEI**），排除本帖、跨社群、按 `postId` 去重并过滤低于可配置相似度阈值的结果（阈值在 P9.0 spike 用线上 55 篇真帖校准）。前端在帖子详情页正文与评论区之间**懒加载**展示，空结果或降级时整块静默隐藏 | 零实时 Embedding 开销即可服务游客读路径；静默降级与懒加载保证帖子详情首屏稳定性 |
| D10 故障降级 | **TEI 不可用时**：`search_posts` 自动退化为纯 BM25；`search_my_knowledge` 返回“个人知识库暂不可用”由模型如实转告用户；`related` 返回空列表使帖子页静默隐藏。**ES 不可用时**：同上降级，个人档案注入与对话主链路不受影响，P6 关键词搜索与主站发帖/浏览完全隔离 | 守住「AI / 向量设施不可用时主站零连坐」架构底线 |
| D11 检索评测 | 在 P9.0 编写约 **20 条**「问法 → 预期命中帖子」的评测集与脚本（非单元测试），对比纯 BM25、纯向量、混合 RRF 三者的 `Recall@5`，并同步校准「相关帖子」相似度阈值；实测数据回写 `docs/project.md`（注明 55 篇存量样本仅供方向参考） | 用可复现的量化对比验证混合检索增益与相关帖阈值，避免拍脑袋调参 |
| D12 错误码契约 | 在 `44xxx` 段续编 4 个错误码（全站 **36 → 40 码**）：`44007 AI_PROFILE_LIMIT_EXCEEDED` (200)、`44008 AI_PROFILE_NOT_FOUND` (404)、`44009 AI_NOTE_LIMIT_EXCEEDED` (200)、`44010 AI_NOTE_NOT_FOUND` (404) | 与既有 P8 `44xxx` 错误码分段与 `contract/error-codes.json` 单一事实源保持一致 |

---

## 3. 契约变更（P9.0 闸门）

### 3.1 新增错误码（`44xxx` 段，36 → 40 码）
登记至 `contract/error-codes.json`，同步 `AiErrorCode`（`kuaikan-common`）与 `ErrorHttpStatus` 映射，执行 `npm run gen:contract` 生成 `web/src/shared/api/error-codes.gen.ts` 并通过 `node deploy/bin/check-contract.mjs`：

| 码 | 名称 | HTTP | owner | 默认文案 | 使用场景 |
|---|---|---|---|---|---|
| `44007` | `AI_PROFILE_LIMIT_EXCEEDED` | 200 | `ai` | 个人 AI 档案条目已达上限（最多 30 条） | 新增档案条目超出每人 30 条上限 |
| `44008` | `AI_PROFILE_NOT_FOUND` | 404 | `ai` | 档案条目不存在或无权访问 | 修改/删除不存在或非本人的档案条目 |
| `44009` | `AI_NOTE_LIMIT_EXCEEDED` | 200 | `ai` | 个人笔记数量已达上限（最多 200 篇） | 新建笔记超出每人 200 篇上限 |
| `44010` | `AI_NOTE_NOT_FOUND` | 404 | `ai` | 笔记不存在或无权访问 | 读取/修改/删除不存在或非本人的笔记 |

### 3.2 RocketMQ Topic 与 Outbox 契约
- 新增 Topic 常量（`Topics.java`）与初始化脚本登记（`deploy/compose/rocketmq/init-topics.sh`）：
  - **`kuaikan_note_changed`**（`Topics.NOTE_CHANGED`）：由 `ai-service` 在创建/更新/停用/启用/硬删除笔记的本地事务内写 `t_outbox` 发出；载荷仅含 `eventId`、`occurredAt`、`noteId`、`ownerId`（**严禁携带笔记正文**）。
- 新增消费组（`search-service`）：
  - `kuaikan-search-post-vector-consumer`：独立订阅 `kuaikan_post_created` / `kuaikan_post_deleted`，专责维护 `post_chunk_write`（与 P6 `kuaikan-search-post-created-consumer` 解耦）。
  - `kuaikan-search-note-vector-consumer`：订阅 `kuaikan_note_changed`，回查 `ai-service` `/internal/notes/{noteId}` 后更新或清理 `note_chunk_write`。

### 3.3 网关白名单与 Compose 基础设施
- **网关公开正则白名单**（`services/gateway/src/main/resources/application.yml`）：追加 1 条只放行 `GET` 的正则 `/api/search/posts/[^/]+/related$`（供帖子页游客展示相关帖子）；`ai-service` 全部新增公开接口（`/api/ai/profile/**`、`/api/ai/notes/**`）受既有 `/api/ai/**` 强制 JWT 鉴权保护；`/internal/**` 仍被网关拒绝。
- **Compose 新增 TEI 容器**（`deploy/compose/compose.yml`）：
  - 服务名：`tei-embedding`（或 `tei`），归入 `core` profile。
  - 镜像：`ghcr.io/huggingface/text-embeddings-inference:cpu-1.x`（具体固定版本标签在 P9.0 spike 实测锁定，预置或持久化挂载 `BAAI/bge-small-zh-v1.5` 模型缓存至 `/opt/kuaikan/data/tei`）。
  - 网络与端口：固定内网 IP `172.30.10.21`（`kuaikan` bridge），**严禁映射宿主机端口**。
  - 内存：`mem_limit: 1g`；健康检查探针检测 `/health`。

---

## 4. 接口契约

> 所有雪花 ID 字段必须标注 `@Schema(type = "string")`，与 `kuaikan-common-web` 全局 `Long→String` 序列化对齐。

### 4.1 `search-service` 接口变更

| 方法 | 路径 | 权限 | 说明 | 所属子阶段 |
|---|---|---|---|---|
| `GET` | `/api/search/posts/{postId}/related?limit=5` | 游客可读（白名单） | 基于本帖已有向量做 kNN 推荐跨社群相关帖（`limit` 默认 5、上限 10；降级或无满足阈值结果时返回空数组） | P9.1 |
| `POST` | `/internal/search/posts` | 仅内网 | **升级**：新增可选 `mode`（`BM25 \| HYBRID`，默认 `HYBRID`）与 `postIds` 白名单过滤（供 `FAVORITE` 检索），沿用原有结构化过滤参数与返回字段 | P9.1 / P9.3 |
| `POST` | `/internal/search/notes` | 仅内网 | **新增**：检索 `note_chunk_read`，必填 `ownerId` 与 `query`（`limit ≤ 8`），混合检索 RRF 归并后返回 `{ noteId, title, snippet, score, updatedAt }` | P9.3 |
| `POST` | `/internal/admin/rebuild` | 仅内网 | **扩展**：支持 `target=ALL \| POST \| POST_CHUNK \| NOTE_CHUNK`（默认兼容既有行为），零停机别名切换重建向量切片索引 | P9.0 / P9.3 |

### 4.2 `ai-service` 接口变更

| 方法 | 外部路径（网关剥前缀前） | 权限 | 说明 | 所属子阶段 |
|---|---|---|---|---|
| `GET` | `/api/ai/profile/entries` | 登录态 | 获取当前用户的全部档案条目（按 `category`、`updatedAt` 排序） | P9.2 |
| `POST` | `/api/ai/profile/entries` | 登录态 | 新增档案条目（`category`: `IDENTITY \| PREFERENCE \| STYLE \| OTHER`，`content` 1~200 字，`enabled` 默认 `true`；超 30 条返 `44007`） | P9.2 |
| `PUT` | `/api/ai/profile/entries/{id}` | 登录态 | 编辑档案条目内容、分类或启停状态（非本人或不存在返 `44008`） | P9.2 |
| `DELETE` | `/api/ai/profile/entries/{id}` | 登录态 | 删除档案条目（非本人或不存在返 `44008`） | P9.2 |
| `GET` | `/api/ai/notes?cursor=&limit=` | 登录态 | 当前用户的笔记列表（游标分页，返回标题、摘要、启用状态、更新时间） | P9.3 |
| `GET` | `/api/ai/notes/{id}` | 登录态 | 获取单篇笔记完整 Markdown 正文（校验归属，非本人或不存在返 `44010`） | P9.3 |
| `POST` | `/api/ai/notes` | 登录态 | 新建私密笔记（`title` 1~100 字，`content` 1~20000 字，`enabled` 默认 `true`；超 200 篇返 `44009`；同事务写 `t_outbox`） | P9.3 |
| `PUT` | `/api/ai/notes/{id}` | 登录态 | 更新笔记标题、正文或启停状态（同事务写 `t_outbox`） | P9.3 |
| `DELETE` | `/api/ai/notes/{id}` | 登录态 | **硬删除**笔记记录，并在同事务写 `t_outbox` 触发清理向量 | P9.3 |
| `GET` | `/internal/notes/{noteId}` | 仅内网 | **新增内部读接口**：供 `search-service` 消费 `kuaikan_note_changed` 回查最新状态（返回存在性、`ownerId`、`title`、`content`、`enabled`、`updatedAt`） | P9.3 |
| `GET` | `/internal/notes/batch?cursor=&limit=100` | 仅内网 | **新增内部读接口**：供 `search-service` 全量重建 `note_chunk_v*` 时游标拉取全部启用笔记 | P9.3 |

### 4.3 对话、帮写与工具协议扩展
- **`POST /api/ai/conversations/{id}/messages`**：请求体新增可选枚举 `retrievalScope`（`ALL | MY_ONLY | CURRENT_COMMUNITY`，默认 `ALL`）。
- **SSE `citations` 事件**：每项追加 `sourceType`（`POST | NOTE | FAVORITE | MY_POST`）与可选 `noteId`（`NOTE` 类型填 `noteId`，其余填 `postId`；`postId` 在 `NOTE` 下为 `null`）。
- **确认卡 `action` 事件**：`t_ai_action.type` 新增 `SAVE_PROFILE_ENTRY`，`payload` 包含 `{ "category": "PREFERENCE", "content": "偏好简洁带代码的 Java 技术回答" }`；执行结果回传仍走 `POST /api/ai/actions/{id}/result`。
- **内部跨服务支撑**：`interaction-service` 复查或补全按 `userId` 获取全量收藏 `postId` 列表的 `/internal/**` 只读端点（上限约束与分页保护），供 `search_my_knowledge(sources=[FAVORITE])` 使用。

---

## 5. ES 索引 Mapping、切片与 RRF 细节

### 5.1 `post_chunk_v{yyyyMMddHHmmss}`（别名 `post_chunk_read` / `post_chunk_write`）
```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "properties": {
      "chunkId":       { "type": "keyword" },
      "postId":        { "type": "keyword" },
      "communityId":   { "type": "keyword" },
      "authorId":      { "type": "keyword" },
      "chunkIndex":    { "type": "integer" },
      "title":         { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "chunkText":     { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "authorNickname": {
        "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "communityName": {
        "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "embedding": {
        "type": "dense_vector",
        "dims": 512,
        "index": true,
        "similarity": "cosine",
        "index_options": { "type": "hnsw", "m": 16, "ef_construction": 100 }
      },
      "createdAt":     { "type": "date" }
    }
  }
}
```

### 5.2 `note_chunk_v{yyyyMMddHHmmss}`（别名 `note_chunk_read` / `note_chunk_write`）
```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "properties": {
      "chunkId":    { "type": "keyword" },
      "noteId":     { "type": "keyword" },
      "ownerId":    { "type": "keyword" },
      "chunkIndex": { "type": "integer" },
      "title":      { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "chunkText":  { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "embedding": {
        "type": "dense_vector",
        "dims": 512,
        "index": true,
        "similarity": "cosine",
        "index_options": { "type": "hnsw", "m": 16, "ef_construction": 100 }
      },
      "updatedAt":  { "type": "date" }
    }
  }
}
```

### 5.3 切片规则与写入幂等
- **Markdown 感知切片**：优先按标题（`#` ~ `###`）与空行段落切分，单块合并至目标约 **400 字**（硬上限 480 字，适配 `bge-small-zh-v1.5` 512 token 窗口），块间保留约 **80 字**重叠；每片 `chunkText` 统一前置 `标题：{title}\n`。
- **更新/删除清理**：重切写入或删除时，先按 `delete_by_query`（`term: { postId }` 或 `term: { noteId }`）清掉该文档旧切片，再批量写新切片（`chunkId = {docId}_{chunkIndex}` 作为 `_id`），避免正文缩短后遗留尾部幽灵切片。

### 5.4 应用层 RRF 融合算法
1. **双路召回**（均携带相同的结构化过滤条件，如 `communityId`、`authorId`、`postIds` 或 `ownerId`）：
   - **BM25 路**：在切片索引执行 `multi_match`（`title^3, chunkText^1`，如帖子同时匹配 `authorNickname`/`communityName`），取 Top `N`（默认 `N = 30`）切片，按 `postId`/`noteId` 归并保留最高分片段得到排名 `rank_bm25(doc)`。
   - **kNN 路**：调 TEI 将 `query` 转为 512 维向量，执行带 `filter` 的 ES `knn` 查询（`k = 30, num_candidates = 60`），同样按 `postId`/`noteId` 归并得到排名 `rank_knn(doc)`。
2. **RRF 打分融合**：
   $$\text{score}(doc) = \sum_{r \in \{\text{bm25}, \text{knn}\}} \frac{1}{k + \text{rank}_r(doc)}, \quad k = 60$$
   按融合总分倒序截断返回 Top `limit` 篇（保留各篇命中的最佳切片摘要及元数据）。
3. **TEI 降级**：若 TEI 超时/熔断，跳过 kNN 路，直接返回 BM25 归并结果（笔记私有检索则返回不可用标识提示用户）。

---

## 6. 数据模型（`kuaikan_ai`，Flyway）

在 P8 `V1`、`V2` 基础上新增两张迁移脚本（保留既有 `t_ai_conversation`、`t_ai_message`、`t_ai_action` 不变）：

### 6.1 `V3__ai_profile_entry.sql`
- **`t_ai_profile_entry`**：
  - `id BIGINT UNSIGNED PK`（雪花）
  - `user_id BIGINT UNSIGNED NOT NULL`
  - `category VARCHAR(24) NOT NULL`（`IDENTITY | PREFERENCE | STYLE | OTHER`）
  - `content VARCHAR(200) NOT NULL`
  - `enabled TINYINT NOT NULL DEFAULT 1`（`1 启用 / 0 停用`）
  - `source VARCHAR(16) NOT NULL DEFAULT 'MANUAL'`（`MANUAL | AI_CONFIRMED`）
  - `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`
  - `updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`
  - 索引：`idx_user_enabled (user_id, enabled, updated_at DESC)`

### 6.2 `V4__ai_note_and_outbox.sql`
- **`t_ai_note`**：
  - `id BIGINT UNSIGNED PK`（雪花）
  - `owner_id BIGINT UNSIGNED NOT NULL`
  - `title VARCHAR(100) NOT NULL`
  - `content MEDIUMTEXT NOT NULL`
  - `enabled TINYINT NOT NULL DEFAULT 1`（`1 启用参与检索 / 0 停用`）
  - `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`
  - `updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`
  - 索引：`idx_owner_updated (owner_id, updated_at DESC, id DESC)`
- **`t_outbox`**：与 `content-service` / `user-service` 完全一致的 `kuaikan-common-outbox` 标准表结构（`id, event_id, topic, payload, status, retry_count, next_retry_at, created_at`），并配置 `@MapperScan` 纳入 `top.katzenyasax.kuaikan.common.outbox` 与开启 `kuaikan.outbox.enabled=true`。

---

## 7. 前端设计

- **帖子详情页「相关帖子」（P9.1）**：
  - 位于帖子正文底部与评论区之间，独立懒加载组件；游客可读，展示最多 5 篇跨社群相关帖（标题、所属社群、作者）；接口返回空列表或异常时整块不渲染，绝不阻碍正文与评论加载。
- **Copilot 抽屉增强（P9.1 ~ P9.3）**：
  - **检索范围切换**：输入框上方提供紧凑三档分段控件 `全部 | 仅我的 | 仅当前社群`（非社群页面时「仅当前社群」置灰并提示，默认 `全部`，仅当前抽屉会话期有效）。
  - **来源区分引用卡**：根据 `CitationItem.sourceType` 展示 `[社区帖子]` / `[我的笔记]` / `[我的收藏]` / `[我的帖子]` 徽标；帖子类点击跳 `/c/{communityName}/p/{postId}`，笔记类点击跳转到 `/me?tab=notes&noteId={noteId}` 或抽屉内联预览。
  - **「存为笔记」按钮**：每条已完成输出的助手回答操作栏新增「存为笔记」按钮，点击后弹出轻量标题确认或一键直存至 `/api/ai/notes` 并给出成功反馈。
  - **档案提议确认卡**：支持渲染 `SAVE_PROFILE_ENTRY` 卡片（展示建议分类与条目文本，支持确认前微调），确认后调用 `POST /api/ai/profile/entries` 并回传结果。
- **`/me` 个人中心扩展（P9.2 ~ P9.3）**：
  - **「我的 AI 档案」Tab**：按分类展示明文条目列表（附来源标记 `手动`/`AI 确认`、条数计数 `n/30`），支持新增、编辑、一键启停开关与删除。
  - **「我的笔记」Tab**：双栏或切换式 Markdown 编辑/预览器（附篇数 `n/200` 与字数 `n/20000` 统计）、启停检索开关、彻底删除二次确认弹窗，以及显眼提示「已启用的笔记在被检索命中时，相关片段会随对话发送至第三方模型服务」。
- **首屏性能与隔离**：所有新增 AI / 档案 / 笔记组件继续按需懒加载，主站首屏零 `/api/ai/**` 请求，相关帖子块独立异步加载失败静默降级。

---

## 8. 安全、隔离与降级

1. **私密隔离三道锁**：
   - **物理索引隔离**：`note_chunk_read` 与 `post_chunk_read` 完全分离，公开与社区查询链路绝不触达 `note_chunk_read`。
   - **服务端强注入身份**：`search_my_knowledge` 与 `/api/ai/notes/**`、`/api/ai/profile/**` 一律取网关注入的 `UserContext.userId()`，模型参数不可传 `ownerId`/`userId`。
   - **读侧 MySQL 复核**：`ai-service` 收到 `note_chunk` 召回结果后，必须回查 `t_ai_note` 确认归属本人、未被硬删除且 `enabled = 1`，彻底封堵异步同步延迟窗口。
2. **数据防泄漏到 MQ 日志**：`kuaikan_note_changed` 事件载荷只放 `noteId` 与 `ownerId`，私密笔记正文不进入 RocketMQ commitlog；后端日志禁止打印笔记正文与档案条目原文。
3. **资源与限流兜底**：TEI 容器 `mem_limit: 1g`、调用超时保护（如 3s 连接 / 5s 单次请求）；单篇笔记 ≤ 2 万字、单人 ≤ 200 篇，档案单条 ≤ 200 字、单人 ≤ 30 条，防止向量化卡顿与提示词溢出。

---

## 9. 分阶段交付与验证计划

沿用「**契约闸门 → 双泳道 → 汇合验收**」节奏推进：

| 子阶段 | 核心内容 | 汇合验收 |
|---|---|---|
| **P9.0 契约闸门 + spike** | 4 个新错误码（36 → 40 码）、`kuaikan_note_changed` topic、网关 GET 白名单 `/api/search/posts/[^/]+/related$`、Compose 接入 `tei-embedding`（`bge-small-zh-v1.5`，`mem_limit: 1g`）、`post_chunk_v*` / `note_chunk_v*` mapping、`search-service` embedding 客户端与存量 55 篇全量回填、~20 条检索评测脚本与相关帖阈值校准 | T0 全绿（`check-contract` / `check-openapi`）；TEI 健康就绪；55 篇存量帖完成向量切片回填；评测集输出 BM25 vs 向量 vs RRF Recall@5 对比记录并回写 `docs/project.md` |
| **P9.1 社区语义与相关帖** | `post_chunk` 独立 MQ 消费组、`search_posts` 升级应用层 RRF 混合检索、`GET /api/search/posts/{id}/related`、前端帖子页「相关帖子」懒加载与 Copilot 范围切换占位/基础接线 | 跨词语义查询可召回并附 `[社区帖子]` 引用；帖子页展示最多 5 篇相关帖且低于阈值/停 TEI 时静默隐藏；停 TEI 后 P6 `/search` 纯 BM25 与发帖照常 |
| **P9.2 个人 AI 档案** | `t_ai_profile_entry` + 档案 CRUD 接口 + 启用条目全量注入对话与帮写 system prompt + `propose_save_profile` / `SAVE_PROFILE_ENTRY` 确认卡 + `/me`「我的 AI 档案」UI | 档案条目跨轮次生效且优先级高于社区帖子；AI 提议未确认时数据库零写入；停用后不再注入；超 30 条返回 `44007` |
| **P9.3 私密笔记与我的知识库** | `t_ai_note` + `t_outbox` + `/internal/notes/**` + `note_chunk` 消费与重建 + `search_my_knowledge(NOTE\|FAVORITE\|MY_POST)` + 三档 `retrievalScope` + 引用来源标签 + `/me`「我的笔记」与 Copilot「存为笔记」 | 语义检索本人私密笔记/收藏/发帖附准确来源标签；`MY_ONLY` 零社区帖子召回；跨用户检索零越权；删除或停用笔记后零召回 |
| **P9.4 验收** | `verify-p9.sh`（L0~L4 全链路）+ 回写 `docs/project.md` | **核心硬断言全绿**：笔记跨用户零越权、删除/停用笔记立即可验证不再被召回、停掉 TEI 后主站与 P6 关键词搜索完全正常、档案确认卡未确认零写入、工作区干净且线上零测试残留 |
