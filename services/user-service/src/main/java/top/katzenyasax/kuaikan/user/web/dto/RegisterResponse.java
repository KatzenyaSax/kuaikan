package top.katzenyasax.kuaikan.user.web.dto;

import java.time.LocalDateTime;

/** 注册成功返回。刻意不含 token —— 注册后由前端引导到登录页（P1.2 再决定是否自动登录） */
public record RegisterResponse(
        Long userId,
        String email,
        String nickname,
        LocalDateTime createdAt
) {
}
