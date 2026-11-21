package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 批量查帖子摘要（P5.5.3）。「我的收藏」用它补齐展示。
 *
 * <b>为什么是 POST body 而不是 GET query string</b>：50 个 19 位雪花 id 拼成
 * {@code ?ids=1,2,...} 约 1 KB，虽然不至于超限，但同形状的
 * {@code POST /posts/by-authors}（200 个 id 约 4 KB）已经踩过 URI 上限的坑，
 * 两个批量读端点保持同一种形状比"一个能放下就用 GET"更好记（p55-social.md §3.3）。
 *
 * <b>id 按字符串接收</b>：雪花 id 超出 JS 安全整数范围，全站 id 一律字符串。
 * 服务端解析为正 Long 并去重保序；非法数字、非正整数、超过 50 个一律 40010 ——
 * 静默丢弃会让前端把"我传错了一个 id"误判成"这篇帖子被删了"。
 *
 * null / 空列表不是错误：直接返回空列表，前端不必特殊分支。
 */
public record BatchPostsRequest(
        @ArraySchema(
                arraySchema = @Schema(description = "帖子 id 列表（字符串雪花 id）；上限 50"),
                schema = @Schema(type = "string"))
        List<String> ids
) {
}
