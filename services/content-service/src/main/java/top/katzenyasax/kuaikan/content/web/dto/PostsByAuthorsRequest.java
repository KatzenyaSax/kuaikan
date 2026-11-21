package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 按作者集合查时间线（{@code /following} 页右栏的「全部关注」）。
 *
 * <b>为什么是 POST body 而不是 query string</b>：200 个 19 位雪花 id 拼成
 * {@code ?authorIds=1,2,...} 约 4 KB，正好在容器/代理的 URI 长度上限附近，
 * 极易 414（P5.1 批量 ID 已经踩过一次）。body 没有这个问题。
 *
 * <b>id 按字符串接收</b>：雪花 id 超过 JS 安全整数范围，全站「id 一律字符串」。
 * 服务端解析为正 Long，非法数字一律 40010 —— 不做静默丢弃，
 * 静默丢弃会让前端以为"这些作者没发过帖子"。
 *
 * 空 / null 列表不是错误：前端在没有关注任何人时直接拿到空页，不必特殊分支。
 */
public record PostsByAuthorsRequest(
        @ArraySchema(
                arraySchema = @Schema(description = "作者 id 列表（字符串雪花 id）；上限 kuaikan.content.max-author-ids"),
                schema = @Schema(type = "string"))
        List<String> authorIds,

        @Schema(description = "下一页游标；为 null 表示第一页")
        String cursor,

        @Schema(description = "每页条数，默认 20，最大 50")
        Integer limit
) {
}
