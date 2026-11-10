package top.katzenyasax.kuaikan.user.web.dto;

/**
 * 登录/续期的响应体。
 *
 * **只含 access token**：refresh token 通过 httpOnly cookie 下发，JS 读不到。
 * 这也意味着前端无法通过"检查有没有 token"判断登录态——必须靠
 * 一次 /auth/me 或 /auth/refresh 的返回值（见 p1-auth.md §三）。
 */
public record LoginResponse(
        String accessToken,
        String tokenType,
        long expiresIn,
        UserProfile user
) {
    public static LoginResponse of(String accessToken, long expiresIn, UserProfile user) {
        return new LoginResponse(accessToken, "Bearer", expiresIn, user);
    }
}
