package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 我对某个社群的个人状态（{@code GET /communities/{name}/my-status}）。
 *
 * <b>必须登录，且不在网关白名单里</b>：它整个响应都是"按人变化的"，
 * 一旦被公开路径放行，网关就会剥离身份、返回一个恒定的
 * {@code joined=false, admin=false}，症状是"登录了但按钮永远显示未加入"。
 *
 * 五个字段回答的是三件不同的事，前端据此决定按钮：
 *   joined  → 加入 / 退出
 *   admin   → 是否显示「管理社群」入口与快捷删帖
 *   banned  → 禁用加入与发帖，并展示封禁提示条（reason / bannedUntil）
 *
 * {@code bannedUntil} 为 null 且 {@code banned=true} 表示**永久封禁**，
 * 前端必须区分这两种文案（"解封时间 x" vs "永久"）。
 */
public record MyCommunityStatus(
        @Schema(description = "是否为在社成员；被封禁时恒为 false")
        boolean joined,
        @Schema(description = "是否为当前社群管理员（t_community.owner_id）")
        boolean admin,
        @Schema(description = "是否处在有效封禁中")
        boolean banned,
        @Schema(description = "封禁原因；未封禁时为 null")
        String banReason,
        @Schema(description = "封禁到期时间；永久封禁或未封禁时为 null")
        LocalDateTime bannedUntil
) {
}
