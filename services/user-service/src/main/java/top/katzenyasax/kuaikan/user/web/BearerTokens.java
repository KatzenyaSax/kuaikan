package top.katzenyasax.kuaikan.user.web;

/** Authorization: Bearer <token> 的解析 */
public final class BearerTokens {

    private static final String PREFIX = "Bearer ";

    /** 取不到时返回 null —— 是否 401 由调用方决定 */
    public static String extract(String authorizationHeader) {
        if (authorizationHeader == null) {
            return null;
        }
        String trimmed = authorizationHeader.trim();
        if (trimmed.length() <= PREFIX.length()) {
            return null;
        }
        if (!trimmed.regionMatches(true, 0, PREFIX, 0, PREFIX.length())) {
            return null;
        }
        String token = trimmed.substring(PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    private BearerTokens() {
    }
}
