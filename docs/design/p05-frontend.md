# P0.5 前端基础设施

> 阶段定位见 `roadmap.md`。本文只规定 P0.5 范围内的做法，不涉及任何业务页面。

## 目标与边界

**目标**：用最小代价把前端工具链的未知数清零，让 P1 的前后端能真正并行。

**边界**：只做"能让页面存在并拿到真实数据"的基础设施。不做登录页、注册页、帖子列表、帖子详情、任何 `/api/user/auth/**` 调用、Zustand 里的用户态、业务组件。

验收物是一个**能显示后端真实数据的空壳**（把 `/test/` 的服务状态用 React 重写）。

## 贯穿全程的操作性约定

| # | 约定 | 原因 |
|---|---|---|
| 1 | 所有 npm 命令前显式 `export PATH="$HOME/.local/node/current/bin:$PATH"` | 开发机上有 3 个 Node（`/usr/local/bin` 22.22.1、`/opt/homebrew/bin` 25.8.0、`~/.local/node/current` 22.23.4），`.node-version` 只约束工具，实际执行必须显式锁定 |
| 2 | `package-lock.json` 入库，用 `npm ci` 复现 | 版本漂移是前端最常见的"我这儿能跑" |
| 3 | `web/openapi/*.json` 与 `types/*.gen.ts` 入库 | 让契约漂移变成 `git diff` 能发现的错误 |
| 4 | 只用 npm，不引入 pnpm / yarn | 与 `project.md` 记录的工具链一致 |
| 5 | 生成物顶部标注"由 npm run gen:types 生成，禁止手改" | 手改生成的类型是契约失效的第一种死法 |
| 6 | registry 先用官方源，超 3 分钟再切 npmmirror 并记录 | 不预先假设网络状况 |

## 目录结构

```
web/
├── .node-version
├── package.json / package-lock.json
├── tsconfig.json / tsconfig.node.json
├── vite.config.ts
├── eslint.config.js
├── index.html
├── openapi/                     后端 spec（openapi-dump.sh 产出，入库）
└── src/
    ├── main.tsx
    ├── app/{router,providers,query-client}.tsx
    ├── routes/{root,home,not-found,error-demo}.tsx
    ├── features/status/         唯一的业务 feature：服务状态（P0.5 验收物）
    ├── shared/
    │   ├── api/{client.ts, types/*.gen.ts}
    │   ├── lib/{env,cn}.ts
    │   └── ui/{button,card,skeleton}.tsx
    └── styles/index.css
```

**按 `features/` 切而不是按技术层切**：P2 之后每个业务域同时有 api、组件、hooks，按技术层切会让改一个功能跳三个目录。

## TypeScript 严格档

```jsonc
"strict": true,
"noUncheckedIndexedAccess": true,      // arr[0] 是 T | undefined
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
"verbatimModuleSyntax": true
```

**必须在第一行代码之前开启。** 项目一旦跑起来再开，会一次性冒出几百个错误，等于永远开不了。这几项拦的正是"后端少返回一个字段导致线上白屏"这类问题。

## 数据层分层（写进注释作为纪律）

| 内容 | 归属 |
|---|---|
| 服务端返回的一切（用户、帖子、评论、状态） | **TanStack Query** |
| 纯 UI 态（弹窗、侧栏、主题） | **Zustand** |
| 会话态（access token、当前用户 id 的镜像） | **Zustand**，但只是 Query 的镜像，**不作为数据源** |

## HTTP 层契约

后端统一返回 `{"code":0,"message":"ok","data":...}`，解包只允许发生在 `shared/api/client.ts` 一处。

| 情况 | 判定 | 行为 |
|---|---|---|
| 成功 | HTTP 2xx 且 `code === 0` | 返回 `data` |
| 业务错误 | HTTP 2xx 且 `code !== 0` | 抛 `ApiError(code, message)` |
| 未登录 | HTTP 401 | 先走 `onUnauthorized` 钩子（P0.5 空实现），再抛 `ApiError` |
| 限流 | HTTP 429 | 抛 `ApiError`，不自动重试 |
| 网络/超时 | — | 抛 `ApiError('NETWORK')` |

**HTTP 状态码只表达传输层语义**（401/403/429/500），业务错误一律 200 + `code != 0`。这条反向约束 P1 的后端实现。

所有请求默认 `credentials: 'include'`——P1 的 refresh token 放在 `httpOnly` cookie 里。

## Token 存储（P0.5 只留接口）

- access token：内存（Zustand），**不落 localStorage**
- refresh token：`httpOnly` + `Secure` + `SameSite=Lax` cookie
- P0.5 预留两个位置：`credentials: 'include'`、启动时静默续期（空实现）

理由：产品后续会有用户提交的富文本内容，XSS 面真实存在；`localStorage` 里的 30 天 refresh token 一旦泄漏等于账号永久失守。

## UI 原子

**手写 `button` / `card` / `skeleton` 三个，不引 shadcn CLI**。CLI 需要联网拉 registry，为 3 个组件引入不可控依赖不划算。

但**保留 shadcn 的 CSS 变量约定**（`--background` / `--foreground` / `--primary` / `--border` / `--radius`），将来接 CLI 是无痛的。

## 后端契约导出

- 7 个 servlet 服务加 `springdoc`，`api-docs.path: /internal/api-docs`，`swagger-ui.enabled: false`
- **gateway 不加**（没有业务接口）
- **网关新增内部路径拒绝过滤器**：路径匹配 `^/api/[^/]+/internal/.*` 直接返回 404

  现有路由 `/api/user/**` + `StripPrefix=2` 会把 `/api/user/internal/api-docs` 转发成 `/internal/api-docs` 并返回 200，契约就泄漏了。这个过滤器把「不变量 7：网关不得路由 `/internal/**`」从文档承诺变成代码强制。

- `deploy/bin/openapi-dump.sh` 从容器内拉取 7 份 spec 到 `web/openapi/`

## 发布通道

`deploy/bin/deploy-web.sh`：`npm run build` → rsync `dist/` 到 `/opt/kuaikan/frontend/dist/`，**绝不触碰 `/opt/kuaikan/frontend/test/`**。

## 验收（`deploy/bin/verify-p05.sh`，9 层）

| 层 | 断言 | 性质 |
|---|---|---|
| L1 | `typecheck` 0 error、`build` 成功 | 脚本 |
| L2 | `gen:types` 后 `git diff --exit-code` 为空 | 脚本（契约漂移探测） |
| L3 | 7 个服务 `code=0` 且 `data.host` 非空；`/api/nope/ping` → 404 | 脚本（Node 直连后端） |
| L4 | `/` 返回含 `<script type="module"` 且不含"前端尚未构建" | 脚本 |
| L5 | 从 L4 抽出的 `/assets/*.js` 返回 200 且 content-type 含 javascript | 脚本 |
| L6a | `/whatever` 返回 200 且是 `index.html` | 脚本 |
| L6b | 浏览器打开 `/whatever` 显示 404 UI | **人工** |
| L7 | `/api/user/internal/api-docs` → **404** | 脚本（安全断言） |
| L8 | `deploy/bin/verify.sh --no-restart` 16 条仍全绿；`/test/` → 200 | 脚本（回归） |
| L9 | `git status --porcelain` 为空 | 脚本 |

**L6b 保留人工的理由**：无头浏览器（Playwright）能覆盖，但要引入约 300MB 依赖和一整套 CI 依赖，为 1 条断言不划算。

**何时必须补上 Playwright**：P1 出现登录表单之后——那时会有"填错密码显示什么""401 后跳哪里"这类只有浏览器能验的行为。

## 明确不做

登录页、注册页、帖子列表、帖子详情、`/api/user/auth/**` 调用、Zustand 用户态、Playwright、i18n、深色模式、移动端适配、图片上传。

## 风险与回退

| 风险 | 回退 |
|---|---|
| Tailwind 4 与 Vite 7 插件不兼容 | 降 Tailwind 3.x，记进 `project.md` |
| springdoc 输出 OpenAPI 3.1，`openapi-typescript` 解析失败 | 降 springdoc 版本使其输出 3.0 |
| `exactOptionalPropertyTypes` 与第三方库类型冲突 | `skipLibCheck` 已默认开启，不影响自有代码 |
| npm 官方源过慢 | 切 npmmirror 并记进 `web/.npmrc` |
