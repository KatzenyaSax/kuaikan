package top.katzenyasax.kuaikan.search.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 对外搜索结果的一项（p6-search.md §5.1）。
 *
 * <h2>为什么 ID 是 String</h2>
 *
 * 帖子 / 社群 / 作者 id 都是 19 位雪花号，超过 JS 的 53 位安全整数范围。
 * ES 里它们本来就是 {@code keyword}，这里用 String 直出，没有任何转换；
 * 再配 {@code @Schema(type = "string")}，生成的 TS 类型才是 {@code string}
 * 而不是 {@code number}（JacksonConfig 只保证运行时的 JSON，管不到契约）。
 *
 * <h2>为什么 title 与 titleHighlight 都给</h2>
 *
 * 高亮是"尽力而为"：关键词可能只命中正文，或者高亮片段恰好被截断。
 * 前端需要一份**永远可用**的标题来渲染卡片，所以原文与高亮并存，
 * 高亮为空时用 {@code title}。正文同理只有 {@code bodySnippet}（列表页不需要全文）。
 *
 * <h2>高亮标记不是 HTML</h2>
 *
 * 命中词由 {@code \uE000} / {@code \uE001}（Unicode 私有使用区）包裹。
 * 后端**绝不输出** {@code <mark>} 之类的标签 —— 帖子正文是用户输入，
 * 后排 HTML 就是反射型 XSS。前端按这两个字符切成文本节点与 {@code <mark>} 元素。
 *
 * @param titleHighlight 命中词被 {@code \uE000}/{@code \uE001} 包裹；未命中时为原 {@code title}
 * @param bodySnippet    高亮片段优先，未命中时取正文前 160 字
 */
public record SearchPostItem(
        @Schema(type = "string", description = "帖子 id（雪花 id，字符串化）")
        String postId,
        @Schema(type = "string", description = "社群 id（雪花 id，字符串化）")
        String communityId,
        @Schema(description = "社群名（索引里的反范式字段，创建后不可改）")
        String communityName,
        @Schema(type = "string", description = "作者 id（雪花 id，字符串化）")
        String authorId,
        @Schema(description = "作者昵称（索引里的反范式字段，改昵称时由事件同步）")
        String authorNickname,
        String title,
        @Schema(description = "标题高亮；命中词由 \\uE000 / \\uE001 包裹，未命中回落到原 title")
        String titleHighlight,
        @Schema(description = "正文摘要；优先高亮片段，未命中取正文前 160 字")
        String bodySnippet,
        LocalDateTime createdAt
) {
}
