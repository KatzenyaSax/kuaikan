package top.katzenyasax.kuaikan.notification.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 游标分页。**不用 offset**（不变量 11）：消息一直在增长，
 * offset 分页会重复或漏掉——用户下拉一次多出一条重复消息是最显眼的 bug。
 *
 * @param nextCursor 为空表示没有下一页
 */
public record MessagePage(
        List<MessageView> items,
        @Schema(description = "下一页游标；为空表示到底了") String nextCursor
) {
}
