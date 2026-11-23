# P6 全文搜索技术方案（面向用户 + 内部系统 / 未来 AI 助手）

> 状态：已定稿，按 P6.0 ~ P6.5 分阶段落地。
> 架构不变量见 [`architecture.md`](./architecture.md)，版本与运行事实见 [`../project.md`](../project.md)。

---

## 1. 目标与边界

### 1.1 目标
1. **准实时全文索引**：发帖 / 删帖（及后续编辑）通过本地消息表（`t_outbox`）→ RocketMQ → `search-service` 异步同步至 Elasticsearch，ES 故障不影响主站发帖与浏览。
2. **反范式字段同步**：索引文档包含 `postId`、`title`、`body`、`authorId`、`authorNickname`、`communityId`、`communityName`、`createdAt`。其中社群名创建后不可改（本地缓存）；用户修改昵称时由 `user-service` 发事件触发 ES `update_by_query` 同步更新历史帖子的 `authorNickname`。
3. **双面检索能力**：
   - **面向用户（公网游客可读）**：`GET /api/search/posts`，支持关键词多字段加权检索、中文 IK 分词、安全高亮片段、社群筛选、相关性 / 最新排序、ES `search_after` 游标分页。
   - **面向系统（仅内网 `/internal/**`，服务未来 AI 助手）**：`POST /internal/search/posts`，支持按 `keyword` / `authorId` / `authorNickname` / `communityId` / `communityName` / 时间范围任意组合过滤，支持 `includeBody=true` 返回完整正文供 AI 阅读总结。
4. **零停机全量重建**：提供 `POST /internal/admin/rebuild`（仅内网），通过索引别名切换（`post_read` → `post_v{ts}`）完成存量帖回填与漂移修复。

### 1.2 明确边界（不在 P6 实施）
- **私密站内消息不进 ES**：`search-service` 只索引公开帖子（`status=1`）；未来 AI 助手读取并总结站内消息时直接走 `notification-service` 的 `/internal/**` 接口。
- **AI 助手与委派写权限留作独立阶段**：未来独立 `ai-service` 读能力直连本服务的 `/internal/search/posts`，代用户执行写操作（发帖、收藏、改昵称/头像）由未来独立方案设计受控委派与用户确认机制，不耦合进 `search-service`。

---

## 2. 基础设施与部署（Elasticsearch + IK）

- **镜像**：`deploy/docker/elasticsearch/Dockerfile`，基于 `docker.elastic.co/elasticsearch/elasticsearch:8.17.4`（或与 IK release 精确对齐的 8.x 固定版本），构建阶段预装对应版本的 `analysis-ik` 插件，避免容器重启丢失插件。
- **编排（`deploy/compose/compose.yml`）**：
  - 服务名：`elasticsearch`，归入 `core` profile（与 MySQL / Redis / Nacos / RocketMQ 统一管理，避免跨 profile 缺失）。
  - 固定内网 IP：`172.30.10.15`（`kuaikan` 网络）。
  - 端口：**严禁映射宿主机端口**（遵守不变量 7）。
  - 内存：`ES_JAVA_OPTS=-Xms512m -Xmx512m`，容器上限 `1024m`。
  - 模式：`discovery.type=single-node`，`xpack.security.enabled=false`（纯内网）。
  - 卷挂载：`/opt/kuaikan/data/elasticsearch:/usr/share/elasticsearch/data`（属主 uid `1000:0`）。
  - 健康检查：`curl -fsS http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=5s`。
- **`search-service` 容错**：
  - `search-service` 不拥有数据库（无 datasource），不强依赖 ES 存活才通过 readiness 检查——ES 停机时 `search-service` 进程保持存活，对外检索返回受控 `503 / 50300`，且绝不影响 `content-service` 发帖与浏览。

---

## 3. 事件契约与同步链路

### 3.1 新增 Topic 与事件 DTO（`kuaikan-common`）

均遵循下划线命名规范 `kuaikan_{domain}_{event}`，并登记到 `deploy/compose/rocketmq/init-topics.sh` 与 `Topics.java`：

| Topic 常量 | Topic 名 | 生产方 | 消费方（组名） | 载荷关键字段 |
|---|---|---|---|---|
| `POST_CREATED` | `kuaikan_post_created` | `content-service` | `search-service` (`kuaikan-search-post-created-consumer`) | `eventId`, `occurredAt`, `postId`, `communityId`, `authorId`, `title`, `body`, `createdAt` |
| `POST_DELETED` | `kuaikan_post_deleted` | `content-service` | `search-service` (`kuaikan-search-post-deleted-consumer`) | `eventId`, `occurredAt`, `postId` |
| `USER_PROFILE_UPDATED` | `kuaikan_user_profile_updated` | `user-service` | `search-service` (`kuaikan-search-user-updated-consumer`) | `eventId`, `occurredAt`, `userId`, `nickname` |

> 说明：`content-service` 与 `user-service` 均已接入 `t_outbox`（P3/P4.4/P5.5），发帖、删帖、修改昵称只需在各自本地事务内追加一条 outbox 记录，零新增表。

### 3.2 字段补齐与缓存策略
- **`communityName`**：调用 `community-service` 既有 `GET /internal/communities/{id}`，因社群名创建后不可改，在 `search-service` 内使用 Caffeine 本地缓存（上限 2000 条）永久缓存；全量重建时走批量内部接口 `POST /internal/communities/batch`。
- **`authorNickname`**：调用 `user-service` 内部批量接口 `POST /internal/users/batch`（单条消费也复用批量接口，减少端点膨胀）。
- **幂等与防乱序**：
  - `PostCreated`：以 `postId` 作为 ES 文档 `_id` 覆盖写（`PUT`），天然幂等；写入写入别名 `post_write`（或当前主索引）。
  - `PostDeleted`：按 `postId` 删除 ES 文档（`404` 视为幂等成功）。
  - `UserProfileUpdated`：对当前索引执行 ES `_update_by_query`，匹配 `term: { authorId: userId }`，通过 painless script 更新 `ctx._source.authorNickname = params.nickname`（`conflicts=proceed`）。

---

## 4. ES 索引 Mapping 与重建策略

### 4.1 别名与命名
- 物理索引名：`post_v{yyyyMMddHHmmss}`（初始化默认创建首个物理索引并绑定别名）。
- 读别名：`post_read`（所有查询接口统一读 `post_read`）。
- 写别名：`post_write`（日常事件消费写入 `post_write`；未初始化时启动自检创建首个索引并绑定 `post_read` + `post_write`）。

### 4.2 Mapping 定义

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "properties": {
      "postId":         { "type": "keyword" },
      "communityId":    { "type": "keyword" },
      "authorId":       { "type": "keyword" },
      "title":          { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "body":           { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "authorNickname": {
        "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "communityName": {
        "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "createdAt":      { "type": "date" }
    }
  }
}
```

### 4.3 零停机全量重建（`POST /internal/admin/rebuild`）
1. 创建新物理索引 `post_v{ts}`（带上述 mapping）。
2. 通过 `content-service` 的 `GET /internal/search/posts?cursor=&limit=200` 游标分页全量拉取 `status=1` 帖子。
3. 每批收集 `authorId` / `communityId`，批量调 `user-service` (`POST /internal/users/batch`) 与 `community-service` (`POST /internal/communities/batch`) 补齐 `authorNickname` / `communityName`，通过 ES Bulk API 写入 `post_v{ts}`。
4. 刷新新索引（`_refresh`），执行原子 `_aliases` 切换：将 `post_read` 与 `post_write` 同步指向 `post_v{ts}`，移除旧物理索引的别名。
5. 删除旧物理索引（保留失败容错：清理失败只记 WARN）。
6. 返回重建统计：`{ indexName, indexedCount, elapsedMs }`。

---

## 5. 双面检索接口契约

### 5.1 面向用户：`GET /api/search/posts`（游客可读，加入网关放行名单）
- **Query 参数**：
  - `q`（必填，trim 后非空，长度 1~100；空则 `40010`）
  - `communityId`（可选，雪花 ID 字符串，按社群过滤）
  - `sort`（可选，`relevance` | `latest`，默认 `relevance`；未知值返回 `40010`）
  - `cursor`（可选，Base64 编码的 `sort` + ES `search_after` 游标；跨排序复用游标返回 `40010`）
  - `limit`（可选，默认 20，范围 1~50）
- **检索与打分**：
  - `multi_match`：`["title^3", "authorNickname^2", "communityName^2", "body^1"]`
  - 若传 `communityId`，在 `bool.filter` 中加 `term: { communityId }`
  - 排序：
    - `relevance`：`[_score desc, createdAt desc, postId desc]`
    - `latest`：`[createdAt desc, postId desc]`
  - 高亮：使用自定义占位符标记（如 `\uE000` / `\uE001`）包裹命中词返回 `titleHighlight` / `bodySnippet`，**不在后端输出裸 HTML 标签**，由前端安全切分渲染 `<mark>`，彻底杜绝 XSS。
- **响应**：`Result<PageResult<SearchPostItem>>`
  - `postId` (`string`), `communityId` (`string`), `communityName`, `authorId` (`string`), `authorNickname`, `title`, `titleHighlight`, `bodySnippet`, `createdAt`
  - 所有 ID 字段标注 `@Schema(type = "string")`。

### 5.2 面向系统 / 未来 AI 助手：`POST /internal/search/posts`（仅内网，网关 404）
- **Request Body (`InternalSearchPostsRequest`)**：
  - `keyword`（可选，全文检索关键词）
  - `authorId`（可选，精确匹配 `authorId`）
  - `authorNickname`（可选，支持精确/模糊，匹配 `authorNickname`）
  - `communityId`（可选，精确匹配 `communityId`）
  - `communityName`（可选，精确匹配 `communityName.keyword` 或模糊）
  - `createdFrom` / `createdTo`（可选，ISO-8601 时间戳范围过滤）
  - `sort`（可选，`relevance` | `latest`，无 `keyword` 时默认 `latest`）
  - `cursor`（可选，游标）
  - `limit`（可选，默认 20，最大 100）
  - `includeBody`（可选，默认 `false`；设为 `true` 时返回完整 `body` 供 AI 阅读总结）
- **响应**：`Result<PageResult<InternalSearchPostItem>>`
  - 包含 `postId`、`communityId`、`communityName`、`authorId`、`authorNickname`、`title`、`body`（仅 `includeBody=true` 时填充）、`excerpt`、`createdAt`。

---

## 6. 前端交互与安全
- 顶栏增加搜索输入框（回车导航 `/search?q=...`）。
- 新增 `/search` 页面（路由放行，游客可读）：
  - 搜索框 + 相关性 / 最新切换 + 社群筛选下拉
  - 搜索结果卡片：标题高亮、正文摘要高亮、社群名、作者昵称、发布时间；整卡可点跳 `/c/{communityName}/p/{postId}`
  - 游标「加载更多」按钮
  - 空结果态、未输入关键词引导态、搜索服务降级态（503）
  - 高亮渲染器：按 `\uE000` / `\uE001` 切分为 React 文本节点与 `<mark>` 元素，禁止 `dangerouslySetInnerHTML`。

---

## 7. 分阶段交付计划（P6.0 ~ P6.5）

- **P6.0**：ES+IK Docker 镜像与 compose 编排 + RocketMQ Topic + `kuaikan-common` 事件契约 + 网关白名单
- **P6.1**：`content-service` / `user-service` / `community-service` 事件生产与内部只读接口
- **P6.2**：`search-service` 索引管理、RocketMQ 消费（建索引/删索引/改昵称同步）与 `POST /internal/admin/rebuild`
- **P6.3**：`search-service` 对外 `GET /api/search/posts` 与对内 `POST /internal/search/posts` + OpenAPI 契约
- **P6.4**：OpenAPI 前端类型同步 + 顶栏搜索框 + `/search` 页面 + 浏览器验证
- **P6.5**：分层验收脚本 `deploy/bin/verify-p6.sh`（L0~L4）全量通过 + 回写 `docs/project.md` 与 `docs/design/roadmap.md`
