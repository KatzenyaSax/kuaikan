package top.katzenyasax.kuaikan.common.web.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记「未登录也可访问」的端点。
 *
 * 这不是给框架看的，是给**契约校验**看的：网关白名单在
 * `services/gateway/src/main/resources/application.yml` 里，而"哪些端点本来就该公开"
 * 只有写 controller 的人知道。两者是同一件事的两个副本，必须能机器比对，
 * 否则漏配白名单 = 游客拿到 401，而且要等到端到端验收才发现。
 *
 * 带这个注解的端点会在 OpenAPI 里变成 `security: []`，
 * `deploy/bin/check-openapi.mjs` 据此校验：
 *
 *   1. 每个 {@code security: []} 的端点必须被网关白名单覆盖
 *   2. 网关白名单里的每条精确路径必须能在某个 spec 里找到（防白名单腐化）
 *
 * ⚠️ 新增游客可读端点时**必须**加这个注解，否则校验覆盖不到它。
 * 注意反向不成立：`/api/[^/]+/ping/**` 这种通配白名单**不需要**加注解，
 * 它是 P1 的已知债务，脚本会把通配条目单独列出来提醒。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface PublicEndpoint {
}
