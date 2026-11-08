# 鉴权集中在网关，凭证失效靠 Redis 白名单

`user-service` 用 RS256 签发 access token（2 小时）与 refresh token（30 天，每次刷新轮换），公钥经 JWKS 端点暴露。网关是唯一验签点：验签 → 查 Redis 白名单 `auth:session:{jti}` → 向下游注入 `X-User-Id` / `X-User-Roles`。下游服务不再解析 token，只从 header 构造认证上下文。理由是论坛必须具备**登出、踢下线、封禁**三种即时失效能力：纯无状态 JWT 只能等过期，有状态 Session 则会牺牲水平扩展与读缓存空间。

## Consequences

- **硬约束**：所有后端服务只能绑定内网地址或 Docker 网络，公网仅暴露 Nginx 的 443。一旦某个服务端口直接暴露到公网，任何人都能伪造 `X-User-Id` 冒充任意用户。
- 三种失效的路径互不重叠：登出删单个 `jti`；踢下线删该用户全部 `jti`；封禁同时改用户状态、清空全部 `jti`、并在登录接口拒绝。
- 游客可读的接口在网关放行名单中显式列出，不得依赖"忘记加鉴权"来放行。
- refresh token 轮换使旧的 refresh 立即作废，可作为异地登录检测的抓手。
