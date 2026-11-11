# P1 身份切片

> 阶段划分见 `roadmap.md`。本文是 P1 的**契约闸门**：不做完这里定义的契约，前后端两条泳道都不许开工。

## 一、P1 要证明的三件事

1. **一张 token 只能由一处签发、一处验证**——否则 8 个服务各验各的，密钥泄漏即全线失守。
2. **身份跨进程传递不可伪造**——客户端能往请求里塞任意 header，网关必须剥离并重建。
3. **"立刻失效"是真的立刻**——登出、踢下线、封禁之后，已签发出去的 token 下一秒就无效。

第 3 条是 P1 存在的全部意义。只做"注册登录发 JWT"，和第 4 层被否掉的纯无状态方案没有区别。

## 二、阶段划分（双泳道 + 汇合点）

| 阶段 | 后端 | 前端 | 汇合验收 |
|---|---|---|---|
| **P1.0 契约闸门** | 错误码枚举、端点冻结 | mock 基座、错误文案表 | 契约一致性脚本通过 |
| **P1.1 注册** | Flyway 建表、验证码、BCrypt、注册开关 | 注册页、验证码倒计时、表单校验 | A：浏览器完成真实注册，库里是 BCrypt 哈希 |
| **P1.2 登录与会话** | RSA + JWKS、签发、refresh 轮换、`/me`、`/sessions` | 登录页、会话层、路由守卫、bootstrap | B：刷新页面与重开浏览器都不掉登录态 |
| **P1.3 网关验签** | GlobalFilter：验签 + 白名单 + 剥离注入 + fail-closed；`kuaikan-common-web` 的 UserContextFilter | 仅接线确认 | C：伪造 `X-User-Id` 无法冒充 |
| **P1.4 三种失效** | 登出 / kick / ban 内部端点 | 登出按钮、被封禁与踢下线提示 | D：三种失效均在浏览器可见 |
| **P1.5 验收** | — | — | `verify-p1.sh` 全绿 |

**顺序不可颠倒**：P1.2 结束时网关是"透传态"，P1.3 才翻成"强制态"。先装守卫会导致登录接口自己被拦、一条链都测不了。

## 三、端点契约

### 对外（经网关，`/api/user/auth/**`）

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/api/user/auth/register/code` | 否 | 发送邮箱验证码 |
| POST | `/api/user/auth/register` | 否 | 注册（受开关控制，默认关闭） |
| POST | `/api/user/auth/login` | 否 | 登录 |
| POST | `/api/user/auth/refresh` | cookie | 续期并轮换 |
| POST | `/api/user/auth/logout` | 是 | 登出当前会话 |
| GET | `/api/user/auth/me` | 是 | 当前用户资料 |
| GET | `/api/user/auth/sessions` | 是 | 我的登录设备列表 |
| DELETE | `/api/user/auth/sessions/{jti}` | 是 | 踢掉某个设备 |

`/sessions` 不是为测试硬造的：用户需要看到自己在哪些设备登录过。它同时让 `/me` 页天然并发两个受保护请求，支撑"并发 401 只触发一次 refresh"的验收。

### 内部（**不经网关**，只能服务器上 curl）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/user/internal/admin/kick` | 踢下线（删除该用户全部 jti） |
| POST | `/api/user/internal/admin/ban` | 封禁（改状态 + 清空 jti + 登录拒绝） |

`/internal/**` 的隔离由 P0.5 的 `InternalPathBlockFilter` 强制（公网一律 404），不是靠约定。

## 四、HTTP 状态码与业务码的分工

**HTTP 状态码只表达传输层语义，业务结果一律走 `code`。** 唯一例外是三个会让前端走特殊分支的状态。

| 场景 | HTTP | code | 前端行为 |
|---|---|---|---|
| 参数校验失败 | **200** | 40010 | 展示字段级错误 |
| 验证码错误或失效 | **200** | 40201 | 展示 code 的文案 |
| 验证码发送过于频繁 | **429** | 40202 | 禁用倒计时按钮 |
| 注册功能未开放 | **403** | 40203 | 提示"暂未开放" |
| 邮箱已被注册 | **200** | 40204 | 定位到邮箱字段 |
| **账号已被封禁** | **403** | 40205 | 专用提示，非通用错误 |
| **用户名或密码错误** | **200** | 40206 | 通用提示，**不区分是哪个错** |
| 未登录 / 凭证无效 | **401** | 40100 | **触发续期流程** |
| 无权限 | 403 | 40300 | 提示无权限 |
| 内部错误 | 500 | 50000 | 通用错误 |
| 依赖不可用（fail-closed） | 503 | 50300 | 提示稍后重试 |

### 为什么"登录失败"必须是 200 + 40206，不能是 401

前端的 401 拦截器会去调 `/auth/refresh`。如果登录失败返回 401，就会触发：

```
登录失败 → 401 → 前端尝试 refresh → 无 cookie，refresh 也 401 → 跳登录
```

用户在登录页上输错密码，却被"跳转到登录页"，而且可能连提示都被覆盖。**这是一个必然发生的死循环**，所以登录凭据错误必须走业务码。

### 防用户枚举

`邮箱不存在` 与 `密码错误` 必须返回**完全相同**的 HTTP 状态、code 和文案。否则攻击者可以用登录接口扫出哪些邮箱注册过。

## 五、Cookie 契约

| 属性 | 值 |
|---|---|
| 名称 | `kuaikan_refresh` |
| `HttpOnly` | 是（JS 不可读） |
| `Secure` | 是 |
| `SameSite` | `Lax` |
| `Path` | `/api/user/auth`（只有 auth 路径会带上它） |
| `Max-Age` | `2592000`（30 天） |

**`Path` 收窄到 `/api/user/auth` 是有意的**：其他接口完全拿不到这个 cookie，泄漏面最小。

## 六、JWT 契约

| 项 | 值 |
|---|---|
| 算法 | RS256 |
| Header | `alg=RS256`、`kid=<密钥标识>` |
| Claims | `sub`(userId)、`jti`、`roles`、`iss=kuaikan`、`iat`、`exp` |
| access 有效期 | 2 小时 |
| refresh 有效期 | 30 天，每次刷新轮换 |
| 公钥分发 | `GET /internal/jwks`（网关懒加载并按 kid 缓存） |

**token 里不放昵称、头像和任何会变的数据。** 放进去等于把用户资料焊死在凭证里。

## 七、Redis 键契约

| Key | 类型 | TTL | 用途 |
|---|---|---|---|
| `auth:session:{accessJti}` | String (userId) | access 剩余时间 | **网关白名单**（正向：知道 jti 问是否有效） |
| `auth:user:{userId}:access` | **ZSet**（member=jti，score=过期时间戳） | access 剩余时间 | 踢下线时批量找（反向：知道 userId 找他所有 jti） |
| `auth:code:{scene}:{email}` | String (code) | 10 分钟 | 验证码 |
| `auth:code:try:{email}` | String (count) | 10 分钟 | 验证码错误次数 |
| `auth:code:rate:email:{email}` | String | 60 秒 | 发送频率限制 |
| `auth:code:rate:ip:{ip}` | String (count) | 1 小时 | 同 IP 发送上限 |

**两处与最初设计不同，以本节为准：**

1. **`auth:refresh:{jti}` 不存在**。refresh token 的真相只在 MySQL（`t_refresh_token`），
   Redis 不参与。理由见 `p1-storage.md`：要能分页列设备、要能审计轮换链、要避免双写一致性。
2. **`auth:user:{id}:access` 是 ZSet 而不是 Set**。Set 的成员没有独立 TTL，只有整个 key 有，
   而每次写入又会重置 key 的 TTL —— 结果是过期的 jti 永远留着，长期活跃用户会累积几百个死成员。
   改成 ZSet 后，score 存 access 过期时间戳，**每次写入顺手 `ZREMRANGEBYSCORE` 清理已过期的**，
   规模被限制在"最近 2 小时内签发的 access 数量"。登出时也会 `ZREM` 掉自己那一条。

两处的 `jti` 是**两个不同的命名空间**（access jti vs refresh jti），永远对不上，这是设计如此。

**网关的白名单查询不做本地缓存。** 缓存 5 秒就等于让"立刻失效"退化成"5 秒内仍有效"，而即时失效正是 P1 的全部意义。50 并发下一次 Redis 往返是亚毫秒级开销。

## 八、错误码唯一事实来源

`contract/error-codes.json` 是**唯一事实来源**。三方必须一致：

```
contract/error-codes.json
   ├─ services/**/ErrorCode*.java    （Java 枚举，脚本比对）
   └─ web/src/shared/api/error-codes.gen.ts  （生成，禁止手改）
```

校验：`node deploy/bin/check-contract.mjs`。P1.5 的 L0 层会调用它。

## 九、前端 mock 基座

`VITE_API_MOCK=1` 时，`client.ts` 把请求交给 `src/shared/api/mock/`，不发真实网络。

**mock 的返回值必须满足 OpenAPI 生成的类型**——后端改了契约而 mock 没跟上，`npm run typecheck` 会直接报错。这样 mock 不可能静默漂移成"假事实"。

不用 MSW：它需要 service worker，为 P1 这点量不值当；而手写 mock 被生成类型约束，反而更难漂移。

## 十、E2E 验收设计（`verify-p1.sh`）

退出码 0 即 P1 完成。

| 层 | 内容 | 模式 |
|---|---|---|
| **L0 契约层** | `gen:types` 后 git diff 为空；错误码三方一致；spec 里不得出现契约表之外的 auth 端点 | 总是 |
| **L1 构建层** | typecheck / lint / build；dev-only 代码不进产物 | 总是 |
| **L2 后端 HTTP 层** | 23 条能力与安全断言（见附录） | 总是（`--deep` 多 2 条） |
| **L3 浏览器层** | 8 条只有浏览器能验的行为（见附录） | 跳过于 `--fast` |
| **L4 回归层** | `verify.sh --no-restart` + `verify-p05.sh --fast` | 总是 |
| **L5 人工清单** | 3 条视觉与文案 | 人工 |

模式：`--fast`（L0~L2+L4，约 40s）／默认（L0~L4）／`--deep`（含破坏性用例）。

### 浏览器层为什么现在必须引入

有三类行为在 HTTP 层根本观察不到：

1. 刷新页面不掉登录态（依赖浏览器自动带 httpOnly cookie）
2. 刷新时不闪登录页（渲染时序）
3. 并发 401 只触发一次 refresh（前端内部请求协调）

工具选型：**用 `playwright` 库自己写断言，不引 `@playwright/test`**。
`AGENTS.md` 禁止写单元测试/TDD 测试，而引入 test runner 会让"测试"的边界变模糊。
脚本形态（`web/scripts/e2e-auth.mjs`）与 `verify.sh` / `smoke-api.mts` 同类，不产生 `*.spec.ts`。

### "不闪登录页"的验证方法

给根节点加 `data-bootstrapping="true"`（bootstrap 未完成时存在）。Playwright 注入 MutationObserver 记录
`[data-testid=login-form]` 是否曾出现，`page.reload()` 后断言**从未出现**，同时断言
`data-bootstrapping` 确实出现过（证明确有加载态，而不是碰巧够快）。

### "并发 401 只触发一次 refresh"的验证方法

不伪造 token 过期（要等 2 小时），而用**踢下线**制造真实场景：

1. 浏览器登录，停在 `/me`
2. 服务器侧调 `kick`（删除该用户全部 jti）
3. Playwright 用 `page.route` 计数 `/auth/refresh` 请求次数
4. 触发导航（`/me` 页并发 `me` + `sessions` 两个受保护请求）
5. 断言：refresh **只被调用 1 次**；最终跳 `/login`；提示"你已被下线"

### 测试数据

E2E 会在唯一环境（生产）创建真实用户：

- 邮箱：`e2e+<时间戳>@kuaikan.test`（不存在的域）
- 昵称：`e2e-<时间戳>`
- 结束时通过 SSH 在服务器上 `docker exec mysql` 删除该前缀用户及 token
- 失败时保留数据并打印清单，便于排查

**不做测试专用端点**——那等于在生产上开后门，而验收脚本本就有 SSH 权限。

## 十一、P1 明确不做

- `spring-boot-starter-security`（只引 `spring-security-crypto` 用 BCrypt）
- OAuth2 Resource Server
- 按接口的角色校验（`roles` 只透传，动作级权限在 P7）
- 密码找回、邮箱变更、第三方登录
- 真实邮件服务（P1 用 MailHog，发信抽象成接口）
- 多设备管理 UI 的完整形态（只做列表 + 踢掉某个设备）


---

## 附录 A｜L2 后端 HTTP 层断言（23 条）

### 注册

| # | 断言 | 说明 |
|---|---|---|
| 1 | `register-enabled=false` 时 `POST /register` → **403 / 40203** | 开关默认关闭 |
| 2 | 验证码 60 秒内重发 → **429 / 40202** | 频率限制 |
| 3 | 验证码错误 5 次后，正确码也失败 | 错误计数作废 |
| 4 | 重复邮箱注册 → **200 / 40204** | 唯一性 |
| 5 | 注册成功后库中是 **BCrypt 哈希**（服务器侧 SQL） | 不存明文 |

### 登录与会话

| # | 断言 | 说明 |
|---|---|---|
| 6 | 邮箱不存在 / 密码错误 → **完全相同**的 HTTP + code + 文案 | 防用户枚举 |
| 7 | 正确凭据 → 200，返回 accessToken + expiresIn + user | |
| 8 | `Set-Cookie` 含 `HttpOnly` `Secure` `SameSite=Lax` `Path=/api/user/auth` `Max-Age=2592000` | 用 `response.headers.getSetCookie()` 断言，无需浏览器 |

### 身份与信任边界

| # | 断言 | 说明 |
|---|---|---|
| 9 | `/auth/me` 无 token → **401 / 40100** | 默认拒绝 |
| 10 | 合法 token → 200，userId 正确 | |
| 11 | **合法 token + 伪造 `X-User-Id: 999` → 返回自己的 id** | **头剥离顺序**（安全核心） |
| 12 | 篡改签名 → 401 | 验签 |
| 13 | 过期 token → 401 | exp 校验 |
| 14 | `roles` claim 被篡改 → 401 | 签名覆盖全部 claim |
| 15 | 下游服务端口公网不可达（回归） | 只能走网关 |

### 失效语义

| # | 断言 | 说明 |
|---|---|---|
| 16 | 登出 → 原 access **立刻** 401 | 失效 ① |
| 17 | 登出 → 该 refresh 也失效 | |
| 18 | refresh 轮换：旧 refresh（>30s 后）再用 → 401 | 轮换 |
| 19 | 旧 refresh 重放 → 该用户**全部** refresh 作废 | 重放检测 |
| 20 | 30 秒宽限期内重复用同一 refresh → **成功** | 多标签页并发不误杀 |
| 21 | `kick` 后该用户全部 access 立刻 401，**其他用户不受影响** | 失效 ② |
| 22 | `ban` 后：登录 → 403/40205；已签发 access → 401；**游客可读接口仍 200** | 失效 ③ |
| 23 | `/api/user/internal/**` 公网 → **404** | S3 过滤器回归 |

### `--deep` 追加（2 条，破坏性）

| # | 断言 | 说明 |
|---|---|---|
| 24 | 停掉 Redis → 受保护接口返回 **503 而非 200** | **fail-closed** |
| 25 | Redis 恢复后自动恢复服务 | 无残留状态 |

## 附录 B｜L3 浏览器层断言（8 条）

| # | 断言 | 验证手段 |
|---|---|---|
| 1 | 未登录访问 `/me` → 跳 `/login` 且带 `returnTo=/me` | 断言 URL |
| 2 | 登录成功 → 进入 `/me`，显示昵称与邮箱 | DOM |
| 3 | **刷新页面不掉登录态** | `page.reload()` 后仍显示昵称 |
| 4 | **不闪登录页** | MutationObserver 记录 `login-form` 是否曾出现 |
| 5 | `localStorage` / `sessionStorage` 中**没有 token** | 读 keys 并断言不含 access/refresh 字样 |
| 6 | refresh cookie 存在且 `httpOnly === true` | `context.cookies()` |
| 7 | **并发 401 只触发一次 refresh** | `page.route` 计数 + 踢下线制造场景 |
| 8 | 被封禁 → 显示"账号已被封禁"，非通用错误 | DOM 文案 |

## 附录 C｜需要前端提供的 `data-testid`

E2E 依赖这些稳定锚点，P1.1/P1.2 实现时必须加上：

| testid | 位置 |
|---|---|
| `auth-bootstrapping` | bootstrap 未完成时的根容器 |
| `login-form` | 登录表单 |
| `register-form` | 注册表单 |
| `field-email` / `field-password` / `field-code` | 表单字段 |
| `btn-submit` | 提交按钮 |
| `nav-user` | 顶部当前用户区 |
| `btn-logout` | 登出按钮 |
| `session-list` | 设备列表 |
| `toast-error` | 错误提示 |
