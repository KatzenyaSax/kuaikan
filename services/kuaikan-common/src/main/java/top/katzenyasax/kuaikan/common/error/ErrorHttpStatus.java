package top.katzenyasax.kuaikan.common.error;

import java.util.Map;

/**
 * 业务码 → HTTP 状态码。
 *
 * 契约（docs/design/p1-auth.md §4）：**HTTP 状态码只表达传输层语义**，
 * 业务结果一律走 code。绝大多数业务码对应 HTTP 200；
 * 只有下面这几个会让前端走特殊分支，必须给真实状态码。
 *
 * 这份映射由 contract/error-codes.json 的 http 字段定义，
 * `node deploy/bin/check-contract.mjs` 会校验两者一致。
 */
public final class ErrorHttpStatus {

    /** 只登记 http != 200 的码；未登记的默认 200 */
    private static final Map<Integer, Integer> SPECIAL = Map.of(
            40100, 401,  // 未登录 / 凭证无效 —— 前端据此触发续期
            40202, 429,  // 验证码发送过于频繁
            40203, 403,  // 注册功能未开放
            40205, 403,  // 账号已被封禁
            40300, 403,  // 无权限
            40400, 404,  // 资源不存在
            40900, 409,  // 状态冲突
            42900, 429,  // 请求过于频繁
            50000, 500,  // 服务内部错误
            50300, 503   // 依赖不可用（fail-closed）
    );

    public static int of(int code) {
        return SPECIAL.getOrDefault(code, 200);
    }

    private ErrorHttpStatus() {
    }
}
