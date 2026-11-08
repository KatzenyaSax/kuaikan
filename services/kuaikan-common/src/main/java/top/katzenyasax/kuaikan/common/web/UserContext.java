package top.katzenyasax.kuaikan.common.web;

import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;

/**
 * 当前请求的身份上下文。由各服务的过滤器从 {@link Headers} 构造，请求结束时必须 clear()。
 */
public final class UserContext {

    private static final ThreadLocal<Long> USER_ID = new ThreadLocal<>();
    private static final ThreadLocal<String> ROLES = new ThreadLocal<>();

    public static void set(Long userId, String roles) {
        USER_ID.set(userId);
        ROLES.set(roles);
    }

    public static Long userId() {
        return USER_ID.get();
    }

    public static Long requireUserId() {
        Long id = USER_ID.get();
        if (id == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        return id;
    }

    public static String roles() {
        return ROLES.get();
    }

    public static void clear() {
        USER_ID.remove();
        ROLES.remove();
    }

    private UserContext() {
    }
}
