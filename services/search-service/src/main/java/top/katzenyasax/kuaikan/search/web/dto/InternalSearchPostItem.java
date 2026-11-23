package top.katzenyasax.kuaikan.search.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 对内搜索结果的一项（p6-search.md §5.2）。给未来的 AI 助手读并总结用。
 *
 * <h2>body 与 excerpt 的分工</h2>
 *
 * {@code excerpt} 永远有（正文前 160 字），用于"先概览再决定要不要深读"；
 * {@code body} 只在 {@code includeBody=true} 时给，因为一页 100 条完整正文
 * 可能几 MB —— 默认不开才是对的默认值。
 *
 * <h2>没有高亮</h2>
 *
 * 对内是机器阅读，{@code \uE000}/{@code \uE001} 这类标记只会污染喂给模型的文本。
 * 需要定位命中位置时，调用方拿 {@code keyword} 自己找。
 *
 * @param body    仅 {@code includeBody=true} 时非空
 * @param excerpt 正文前 160 字摘要
 * @param createdAt epoch 毫秒（与 {@code PostCreated} 事件、content 的回填接口同一表示）
 */
public record InternalSearchPostItem(
        @Schema(type = "string", description = "帖子 id（雪花 id，字符串化）")
        String postId,
        @Schema(type = "string", description = "社群 id（雪花 id，字符串化）")
        String communityId,
        String communityName,
        @Schema(type = "string", description = "作者 id（雪花 id，字符串化）")
        String authorId,
        String authorNickname,
        String title,
        @Schema(description = "完整正文；仅 includeBody=true 时返回，否则为 null")
        String body,
        @Schema(description = "正文前 160 字摘要")
        String excerpt,
        @Schema(description = "发布时间，epoch 毫秒")
        long createdAt
) {
}
