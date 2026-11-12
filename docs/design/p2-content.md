# P2 内容读路径 · 设计

> 上游：[`roadmap.md`](./roadmap.md) P2 行、[`architecture.md`](./architecture.md)
> 相关裁决：ADR [0005](./../adr/0005-no-bff-frontend-aggregation.md)（读路径前端聚合）、
> ADR [0008](./../adr/0008-no-internal-signature.md)（服务间身份显式传参）、
> ADR [0009](./../adr/0009-author-summary-live-fetch.md)（作者信息实时拉取）

## 1. 边界

**做**：建社群、加入/退出社群、发帖、社群帖列表（游标分页）、帖子详情、双栏阅读界面。

**刻意不做**：

| 不做 | 归属 |
|---|---|
| 评论 | P3 |
| 点赞 / 收藏 | P3 |
| 任何会变的计数（`like_count` 等列建出来但恒为 0） | P3 |
| 热度排序（只留 `sort` 参数与游标版本位） | P5 |
| 帖子搜索（社群搜索用 SQL `LIKE`，与 P6 的 ES 无关） | P6 |
| 图片上传（头像仍是外链 URL） | P7 |
| Markdown 渲染 | 不计划。纯文本 + `pre-wrap`，避开 XSS 面 |
| 帖子编辑 / 删除 / 草稿 | P4 |
| 虚拟滚动、拖拽分栏、社群封面图 | 不做 |

## 2. 契约（P2.0 冻结）

### 2.1 端点

前置：网关 `StripPrefix=2`，`/api/community/x` → 服务内 `/x`。

**community-service**

| 方法 | 外部路径 | 服务内路径 | 认证 | 说明 |
|---|---|---|---|---|
| GET | `/api/community/communities` | `/communities` | 游客 | 社群列表，游标分页 |
| POST | `/api/community/communities` | `/communities` | 登录 | 建社群，创建者自动成为 owner |
| GET | `/api/community/communities/{name}` | `/communities/{name}` | 游客 | 社群详情（含 `communityId` 与 `viewerJoined`） |
| GET | `/api/community/mine` | `/mine` | 登录 | 我加入的社群（左栏顶部用） |
| POST | `/api/community/communities/{name}/membership` | 同 | 登录 | 加入（幂等） |
| DELETE | `/api/community/communities/{name}/membership` | 同 | 登录 | 退出（幂等，所有者不可退出） |

**content-service**

| 方法 | 外部路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/content/posts?communityId=&sort=new&cursor=&limit=` | 游客 | 社群帖列表 |
| GET | `/api/content/posts/{postId}` | 游客 | 帖子详情 |
| POST | `/api/content/posts` | 登录 | 发帖 |

**user-service（新增）**

| 方法 | 外部路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/user/users?ids=1,2,3` | 游客 | 批量作者摘要 |

**游客可读端点必须标 `@PublicEndpoint`**（`kuaikan-common-web`）。这个注解会让端点
在 OpenAPI 里变成 `security: []`，于是"哪些端点对游客开放"变成可机器判定的，
`check-openapi.mjs` 才能把它和网关白名单比对。全局默认是 `bearerAuth`（需要认证）。

⚠️ **批量摘要只返回 `userId` / `nickname` / `avatarUrl`**，绝不返回 `email`、`status`、`created_at`。
批量上限 100，超限 → `40010`。网关白名单为此单开一条**精确条目**（不复用 `/ping/**` 通配）。

**内部端点**（网关不路由，只能容器网络直连）

| 服务 | 路径 | 说明 |
|---|---|---|
| community | `GET /internal/memberships?communityId=&userId=` | 返回 `{member, role, mutedUntil}` |

### 2.2 新增错误码（15 → 20）

| 码 | 名称 | HTTP | 文案 |
|---|---|---|---|
| `41001` | `COMMUNITY_NOT_FOUND` | 404 | 社群不存在 |
| `41002` | `COMMUNITY_SLUG_TAKEN` | 409 | 该社群标识已被占用 |
| `41004` | `NOT_MEMBER` | 200 | 需要先加入社群 |
| `41005` | `OWNER_CANNOT_LEAVE` | 200 | 社群创建者不能退出 |
| `42001` | `POST_NOT_FOUND` | 404 | 帖子不存在 |

**没有"已是成员"这个错误码**：加入/退出都设计成**幂等成功**（重复加入 → `code 0`，`member_count` 不变）。
幂等用 `INSERT … ON DUPLICATE KEY UPDATE` + 判 `affectedRows`，和 P3 消费幂等是同一个手法。

### 2.3 三个裁决

| 裁决 | 选择 | 记录位置 |
|---|---|---|
| 作者昵称/头像 | **实时批量拉取**，内容表只存 `author_id` | ADR 0009 |
| 发帖权限 | **必须是社群成员** | 本文 §2.4 |
| 列表游标 | **不透明复合游标**（`created_at` + `id`，base64url） | 本文 §3.3 |

### 2.4 发帖权限：这里必须跨服务调用

"必须是成员"的权威数据在 `community-service`。`content-service` 要执行这条策略，
**只能**在发帖时问一次：

```
content-service 发帖前 → GET /internal/memberships?communityId=&userId=   （显式传参，ADR 0008）
```

这与 ADR 0009 拒绝的做法**不矛盾**，区别要说清楚：

| | 抄昵称快照 | 校验成员身份 |
|---|---|---|
| 性质 | 把别人的数据**复制**一份 | 问别人的**权威**数据 |
| 可以不问吗 | 可以（前端拉即可） | 不可以（不问就无法判定） |
| 结果 | 不必要地让写路径依赖 user-service | 必要的依赖 |

**接受的代价**：community-service 挂掉时无法发帖（返回 `50300`，超时 500ms，见 §6 L4）。
读路径完全不受影响——这条边界要在验收里明确测出来。

## 3. 数据模型

### 3.1 `community` schema

```sql
CREATE TABLE t_community (
  id            BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(32)  NOT NULL,   -- 展示名，用户输入原文（trim 后），不可改
  name_key      VARCHAR(64)  NOT NULL,   -- 规范化唯一键，URL 用它
  description   VARCHAR(500) NULL,       -- 自我介绍，纯文本，允许换行
  owner_id      BIGINT UNSIGNED NOT NULL,-- 所有者
  member_count  INT UNSIGNED NOT NULL DEFAULT 1,
  status        TINYINT NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_name_key (name_key),
  KEY idx_status_created (status, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_community_member (
  id            BIGINT UNSIGNED NOT NULL,
  community_id  BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  role          TINYINT NOT NULL DEFAULT 0,   -- 0 成员 / 1 管理员（P7 才有写入者）
  status        TINYINT NOT NULL DEFAULT 1,   -- 0 已退出
  joined_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_community_user (community_id, user_id),
  KEY idx_user_joined (user_id, status, joined_at, id)
);
```

#### 没有 slug —— 社群名本身就是标识

用户建社群时脑子里只有"叫什么"，让他再想一个全站唯一的 ASCII 字符串是纯摩擦，
而且绝大多数用户不知道 URL/slug 是什么。所以：

```
name     = 展示名，用户输入的原文
name_key = 规范化唯一键，系统生成：NFKC + trim + toLowerCase + 连续空白转 "-"
URL      = /c/{name_key}
```

- **NFKC** 处理全角/半角（中文输入法下 "ＡＢＣ" 与 "ABC" 必须视为同名）
- **toLowerCase** 让 `Frontend` 与 `frontend` 是同一个社群
- 用户只填名字与简介，其他什么都不用管；重名返回 `41002`

**副产品：保留字问题消失。** `/c/` 下只有 `{name}` 一种东西，即使社群叫 `new`，
`/c/new` 就是那个社群、`/c/new/new` 是它的发帖页，没有冲突。
（以后若要在 `/c/` 下加静态路由，必须先加保留字检查。）

**代价：社群名创建后不可改。** 名字成了 URL，改名等于让所有旧链接失效。
贴吧与 Reddit 都是这个规则。P7 的管理员工具可直接改库，不走产品接口。

#### 所有者是社区的属性，管理员是成员的身份

| 概念 | 存在哪 | 数量 |
|---|---|---|
| **所有者** | `t_community.owner_id` | 每个社群**恰好一个** |
| **管理员** | `t_community_member.role = 1` | 可多个 |

不用 `role = OWNER` 的理由：MySQL 没有"每社群只能有一行 `role=OWNER`"的部分唯一索引，
那个唯一性只能靠应用层保证；而 `owner_id` 是单列，天然唯一。

**所有者也是成员**（建社群时同一事务插 member 行），所以他能发帖。
但退出要挡住：

> 所有者退出 = 变成"不是成员的所有者"，不能发帖、社群也没人管。
> 所以 **`41005 OWNER_CANNOT_LEAVE`**，转让能力在 P7。

这是 P2 的一个**已知缺口**：中间这段时间所有者想脱身只能由管理员改库。
接受它，因为新建社群的人基本不会想退出。

#### 唯一键带来的硬约束

`uk_community_user` 决定了"退出再加入"不能 DELETE + INSERT，必须

```sql
INSERT INTO t_community_member (...) VALUES (...)
ON DUPLICATE KEY UPDATE status = 1, joined_at = NOW()
```

并按 `affectedRows` 判断要不要给 `member_count + 1`：
**1 = 新插入 → +1，2 = 复活 → +1，0 = 本来就活跃 → 不动**。
这个语义很隐晦，代码里必须写死注释——它和 P3 消费幂等用的是同一个手法。

用软删而不是物理删的两个理由：`member_count` 的增减要靠状态判断而非"行是否消失"；
P7 的禁言不能靠"退出再加入"绕过。

#### 规模计数

- **唯一写入者是 `community-service`，与成员行同一本地事务。** 不跨服务、不发事件。
- 只用相对更新：`UPDATE t_community SET member_count = member_count + 1`，绝不读-改-写。
- 上限 `INT UNSIGNED` 到 42 亿，不设社群规模限制。

#### 自我介绍就是一个字段

`description VARCHAR(500)`，纯文本、允许换行、前端 `pre-wrap` 渲染。
列表卡片与详情页用**同一个字段**（详情全文、列表 CSS 截断）。

不拆成"短简介 + 长介绍"——那等于让用户决定"哪句话放哪"，是把设计问题推给用户。
若以后真需要"吧规"那种长文，加 `t_community_page`，不把 `description` 撑成 TEXT。

**P2 不可编辑**（编辑需要所有者/管理员鉴权，属 P7 治理能力）。

### 3.2 `content` schema

```sql
CREATE TABLE t_post (
  id              BIGINT UNSIGNED NOT NULL,
  community_id    BIGINT UNSIGNED NOT NULL,
  author_id       BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(120) NOT NULL,
  body            MEDIUMTEXT NOT NULL,
  like_count      INT UNSIGNED NOT NULL DEFAULT 0,   -- P3 才有写入者
  comment_count   INT UNSIGNED NOT NULL DEFAULT 0,   -- P3 才有写入者
  favorite_count  INT UNSIGNED NOT NULL DEFAULT 0,   -- P3 才有写入者
  view_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status          TINYINT NOT NULL DEFAULT 1,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_community_created (community_id, status, created_at DESC, id DESC),
  KEY idx_author_created (author_id, created_at DESC, id DESC)
);
```

**`t_post` 里没有任何作者信息列**（ADR 0009）。计数列按 architecture §7 的归属表建立，
但 P2 阶段没有任何写入者。

### 3.3 游标

**不透明字符串**，内容为 base64url 编码的 JSON：

```json
{ "s": "new", "t": 1751938886123, "i": "740300032906513664" }
```

- `s` = 排序标记。**请求的 `sort` 与游标里的 `s` 不一致 → `40010`**，而不是静默用错排序。
- `t` / `i` = 上一页最后一行的 `created_at`（毫秒）与 `id`。
- 前端**不许解析、不许拼**，只做原样回传。

SQL 用行值比较，能走 `idx_community_created`：

```sql
WHERE community_id = ? AND status = 1
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT ?
```

**为什么不用单列 `created_at`**：并发发帖会撞同一个毫秒，单列游标会重复或跳过。
**为什么不把格式写死成"时间戳+id"**：P5 的热度排序需要浮点分数 + 平局打破，
游标形状不同。`s` 字段让两种排序各自解释自己的游标，老客户端不会被静默喂错数据。

P2 只实现 `sort=new`，**其他值返回 `40010`**——不静默降级，否则 P5 上线 `hot` 时无法证明它真的生效。

## 4. 前端设计

### 4.1 线框（≥768px）

```
┌──────────────────────────────────────────────────────────────┐
│ kuaikan                                    [头像 昵称]        │  固定
├────────────────┬─────────────────────────────────────────────┤
│ [🔍 选择社群 ▾] │ 社群名 · 成员 128 · [加入]                   │
│ 我加入的（常驻）│ ─────────────────────────────────────────── │
│  · 前端       │ 标题                                        │
│  · 游戏       │ 作者 · 2 小时前                              │
│  ＋ 发帖       │ ─────────────────────────────────────────── │
│ ─────────────  │                                             │
│ ▌帖子标题 A    │ 正文……                                       │
│   作者 · 2h    │                                             │
│   帖子标题 B   │                                             │
│   作者 · 5h    │      max-width 72ch 居中                     │
│  （独立滚动）  │  （独立滚动）                                │
├────────────────┴─────────────────────────────────────────────┤
│ 280~360px 固定              自适应                            │
└──────────────────────────────────────────────────────────────┘
```

- 页面本身 `overflow: hidden`，**只有两栏各自滚动**，头部固定。
- 左栏顶部：**我加入的社群**（常驻、少量）+ **全量社群可搜索下拉**（combobox）。
  不用横向滚动条——不可发现、不可扩展、无障碍差。
- 右栏空态（`/c/:name`）：显示**社群概览**（描述、成员数、加入按钮），不是"请从左边选一个"。
- 正文限制 `72ch` 阅读宽度。

### 4.2 路由

| 路径 | 渲染 | 说明 |
|---|---|---|
| `/` | 社群列表 | 替换 P0.5 的"注册账号"占位 |
| `/c/:name` | 双栏，右栏 = 社群概览 | layout route 的 index |
| `/c/:name/p/:postId` | 双栏，右栏 = 帖子正文 | layout route 的子路由 |
| `/c/:name/new` | 单栏发帖页 | 长文本表单，独立页面 |
| `/me` | 已有 | — |

**URL 就是状态**：每个帖子都是真实路由，不用 `useState` 换右栏内容。
否则失去分享链接、后退键、刷新保持、`cmd+click` 开新标签。
列表项用 `<Link>`，不用 `div onClick`。

**建社群用弹窗**（首页 +1 按钮），不占路由——一次性短表单。

### 4.3 组件切分

```
<CommunityLayout>                双栏容器（layout route）
  <LeftPane>
    <CommunitySwitcher/>         我加入的 + 搜索下拉
    <PostList/>                  游标加载（IntersectionObserver 哨兵 + 按钮兜底）
  </LeftPane>
  <RightPane><Outlet/></RightPane>
</CommunityLayout>

<CommunityOverview/>             P2.1 写，P2.4 在右栏复用
<PostContent post/>              P2.3 写，P2.4 原样放进右栏
```

**`<PostContent/>` 从第一天就抽成独立组件**，这样 P2.3 的单栏详情页与 P2.4 的右栏
共用同一个渲染体，P2.4 只需换外层容器，重写量≈0。

### 4.4 窄屏（<768px）

路由不变，渲染降级：

| 路由 | 窄屏渲染 |
|---|---|
| `/c/:name` | 只渲染左栏（列表全屏） |
| `/c/:name/p/:postId` | 只渲染右栏（正文全屏），返回键回列表 |

绝不能等到上手机才发现要改——那时路由结构就得重做。

### 4.5 交互规则

1. **切社群** → 列表回顶部、右栏回社群概览、URL 变 `/c/<name_key>`
2. **切帖子** → 左栏滚动位置**保持**、右栏回顶部
3. **浏览器后退** → 按 URL 恢复，列表滚动位置从 `sessionStorage` 还原
4. 列表**最新在上**（`created_at DESC, id DESC`），与游标方向一致
5. **计数为 0 不显示**：P2 的 `like_count`/`comment_count` 全是 0，显示"👍0"会像坏了
6. **游客**：无发帖按钮；加入按钮变"登录后加入"，跳 `/login?redirect=<当前路径>`
7. **作者摘要缺失**（批量接口没返回该 id）→ 显示"已注销用户"，不显示骨架
8. **正文纯文本 + `pre-wrap`**，`dangerouslySetInnerHTML` 一律不用

### 4.6 切社群时的请求时序

列表接口用 `communityId`（不用社群名），所以**冷启动时 `/c/:name` 有一次串行**：

```
GET /api/community/communities/{name}    → 拿到 communityId
GET /api/content/posts?communityId=…     → 才能拉列表
```

优化：如果用户是**点左栏社群切换器**跳转的，`/api/community/mine` 的响应里已经带了
`communityId`，此时两路可以**并行**。只有直接输 URL / 刷新才走串行。

串行窗口用 `placeholderData: keepPreviousData` 避免列表闪空。

**为什么不给 content-service 传社群名**：那等于让它在读路径上查 community-service 的
`名称 → id` 映射，把 ADR 0009 刚清理掉的跨服务读依赖又装回去。多一个 RTT 更便宜。

## 4.7 对 P4 的约束：置顶不进时间线

置顶帖子**不是 `t_post.pinned` 布尔标记**，也**不进 `GET /posts` 的时间线响应**。

理由：`ORDER BY pinned DESC, created_at DESC, id DESC` 会让排序键多一位，
游标必须跟着变，而且置顶帖会**每翻一页都重复出现**或被跳过——论坛分页最经典的坑。

正确形态是置顶作为**独立的有界集合**：

```
GET /api/content/posts?communityId=…&cursor=…   时间线，永不包含置顶
GET /api/content/communities/{id}/pins          置顶区，最多 3~5 条，不分页
```

```
CREATE TABLE t_community_pin (        -- P4 才建，P2 不建
  id            BIGINT UNSIGNED NOT NULL,
  community_id  BIGINT UNSIGNED NOT NULL,
  post_id       BIGINT UNSIGNED NOT NULL,
  pinned_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_community_post (community_id, post_id),
  KEY idx_community_pinned (community_id, pinned_at)
);
```

用独立表而不是 `t_post.pinned`：置顶是**社群的编辑行为**，不是帖子的固有属性。
独立表让加/取消置顶不碰帖子行，不触发帖子缓存失效，也不给帖子的索引加列。

**P2 唯一要做的**：列表响应里现在就不能有 `pinned` 字段。只要做到这一点，
P4 加置顶就是纯增量（加表 + 加端点），不改已有契约、不改游标、不改前端列表逻辑。

## 5. 阶段拆分

每一刀**只引入一个新概念**，且每一刀都有读回路径（否则无法断言）。

| 子阶段 | 交付 | **唯一的新概念** | 汇合验收（一句话） |
|---|---|---|---|
| **P2.0 契约闸门** | 本文档、4 个新错误码（15→19）、`@PublicEndpoint` 与全局 `bearerAuth`、`check-openapi.mjs` 三条检查、`typed.ts` 跨服务合并、**删除 frontend mock**、`verify-p2.sh` 骨架 | 无业务代码 | `check-contract` + `check-openapi` + typecheck + build 全绿 |
| **P2.1 社群** | `t_community` + `t_community_member` V1、建社群、社群列表、社群详情、首页改成社群列表 | **第一个新 schema** | 游客能看社群详情；建社群后创建者是 owner、也是第一个成员、`member_count=1`；名称重复 → `41002` |
| **P2.2 加入社群** | `t_community_member` V1、加入/退出、`/mine`、`member_count` | **第一个"两表同一事务" + 第一个计数** | 加入 `+1`、重复加入幂等不变、退出 `-1`、再加入回到 `+1` |
| **P2.3 发帖** | `t_post` V1、发帖、最小详情 API、`/internal/memberships`、批量作者摘要、`/c/<name_key>/new` 页、单栏详情页 | **第一个用户生成内容 + 第一个"谁有权限写"** | 非成员 → `41004`；成员发帖后 `author_id` 是自己；`X-User-Id` 伪造无效 |
| **P2.4 读路径** | 游标分页、双栏布局、社群切换器、`<PostContent/>` 进右栏、窄屏降级 | **第一个分页读路径** | 游客能浏览；翻页不重不漏；篡改游标 → `40010` |
| **P2.5 验收收口** | `verify-p2.sh`、清数据、回文档 | — | 一条命令全绿 |

> ⚠️ **P2.1 会一次引入两张表。** "建社群"本质上就是"建社群 + 成为第一个成员"，
> 所以 `t_community_member` 无法留到 P2.2——否则创建者不是成员、`member_count`
> 也对不上。P2.2 引入的唯一新概念是**加入/退出与 `member_count` 的增量维护**，
> 不是成员表本身。

**顺序不可颠倒**：社群 ← 加入 ← 发帖 ← 列表。先做列表就没有东西可列，
只能靠脚本插种子数据，前端永远停在"假数据能跑、真接口没验过"。

## 6. 验收（`deploy/bin/verify-p2.sh`，沿用五层）

### L1 契约与构建
契约三方一致（19 码）/ **OpenAPI 与网关白名单一致**（`check-openapi.mjs` 三条：
operationId 跨服务唯一、`security: []` 端点必须在白名单内、白名单精确条目必须存在）/
`gen:types` 无漂移 / `typecheck` / `build`

### L2 后端 HTTP（community，12 条）
游客可读列表与详情 / 游客不能建社群(401) / 建社群成功且名称为中文时 `name_key` 规范化正确 /
建社群者自动 owner 且 `member_count=1` / 名称重复 → `41002` / **所有者退出被拒 → `41005`** / `/mine` 需登录 /
加入 `+1` / 重复加入幂等 / 退出 `-1` / 再加入回到 `+1`（复活路径）/
不存在名称 → `41001` / 列表分页

### L2 后端 HTTP（content，15 条）
游客可读列表与详情 / 非成员发帖 → `41004` / 成员发帖后 `author_id`=自己 /
伪造 `X-User-Id` 无效 / body 里塞 `authorId` 被忽略 / 标题超长 `40010` /
正文超长 `40010` / 不存在 `communityId` → `41001` / 不存在 `postId` → `42001` /
**25 帖翻页不重不漏** / **翻页中途发 3 帖后续页不重复** / 篡改游标 → `40010` /
`sort=hot` → `40010`（P2 明确未实现）/ 跨 `sort` 复用游标 → `40010` /
批量摘要只含 3 个字段且超 100 个 id → `40010`

> **"翻页中途插入新帖"那条是 P2 最值钱的断言。** offset 分页在这种场景下会重复或跳过，
> 游标分页不会。做不到这条等于没测分页。

### L3 浏览器（11 条）
游客首页见社群列表 / 点社群出双栏 / 点帖子右栏换正文且 URL 变 /
**直接访问 `/c/<name>/p/<id>` 冷启动两栏都有数据** / 后退回上一篇 /
滚到底自动加载第二页 / 切社群列表刷新且右栏回概览 /
**375px 下变单栏** / 游客无发帖按钮 / 成员发帖后跳转到新帖 /
列表项显示作者昵称与头像

### L4 破坏性（4 条）
`kill content-service` → 社群页仍可用（读路径不受影响）/
`kill community-service` → 发帖返回 `50300`（不是 500、不是挂住）/
非法 base64 游标 / 并发加入同一社群 `member_count` 不重复

> 第 1、2 条合起来精确刻画了 ADR 0009 与 §2.4 划的边界：
> **读路径零跨服务依赖，只有发帖依赖 community-service。**

### L5 回归
`verify.sh`(P0) + `verify-p05.sh`(P0.5) + `verify-p1.sh`(P1)

### 人工清单
双栏视觉比例、正文行宽、左栏滚动是否独立、窄屏真机手感

## 7. 已知风险

| 风险 | 处置 |
|---|---|
| 双栏在 1280px 笔电上左栏 280px + 正文 72ch 会挤 | P2.4 实测后调左栏上下限，不引入拖拽 |
| 冷启动 `/c/:name/p/:id` 有 3 个串行请求 | 接受。`keepPreviousData` + 骨架避免闪烁 |
| 批量摘要接口成为公网可见面 | 只返回 3 个字段 + 上限 100 + 白名单精确条目 |
| `communityId` 与帖子可能不一致（客户端传别人的社群 id） | 发帖时以 `communityId` 查 membership，成员校验天然覆盖 |
