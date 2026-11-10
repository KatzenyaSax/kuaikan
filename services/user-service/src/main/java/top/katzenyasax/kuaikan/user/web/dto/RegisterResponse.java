package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 注册成功返回。刻意不含 token —— 注册后由前端引导到登录页（P1.2 再决定是否自动登录）。
 *
 * userId 标为 string：全局 Jackson 已把 Long 序列化为字符串（避免 JS 53 位精度丢失），
 * 这里让 OpenAPI 契约与之一致，否则生成的 TS 类型会是 number。
 */
public record RegisterResponse(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串以避免 JS 精度丢失")
        Long userId,
        String email,
        String nickname,
        LocalDateTime createdAt
) {
}
