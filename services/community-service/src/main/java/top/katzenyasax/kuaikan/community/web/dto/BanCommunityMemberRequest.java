package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 封禁社群成员（{@code POST /communities/{name}/bans}，仅管理员）。
 *
 * {@code durationDays} 只允许 **null / 1 / 7 / 30**（null = 永久）。
 * 白名单由前端给四个固定按钮，后端也必须按白名单收：允许任意天数意味着
 * "永久"与"100 年"两种表达同时存在，而封禁名单要按它排序与展示文案。
 *
 * {@code reason} 可选（≤200），会原样展示给被封禁的人（41006 的 message 里），
 * 所以它是**对外可见的文案**，不是内部备注——上限短、只存纯文本。
 */
public record BanCommunityMemberRequest(
        @NotNull(message = "必须指定封禁对象")
        @Schema(type = "string", description = "被封禁的用户 id")
        Long userId,

        @Schema(description = "封禁天数：1 / 7 / 30；null 表示永久封禁")
        Integer durationDays,

        @Size(max = 200, message = "封禁原因不能超过 200 字")
        String reason
) {
}
