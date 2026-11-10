package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/** 一条登录设备记录。一个家族 = 一次登录 */
public record SessionItem(
        String jti,
        String userAgent,
        String ip,
        LocalDateTime issuedAt,
        LocalDateTime expiresAt,
        boolean current
) {
}
