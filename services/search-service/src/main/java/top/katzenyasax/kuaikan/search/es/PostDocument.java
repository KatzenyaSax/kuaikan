package top.katzenyasax.kuaikan.search.es;

/**
 * 一条帖子在 ES 里的形态（反范式读模型）。
 *
 * <h2>为什么 id 全是 String</h2>
 *
 * 雪花 id 是 19 位 Long，而 mapping 里 {@code postId} / {@code communityId} /
 * {@code authorId} 都是 {@code keyword}。用 String 表达，JSON 里就是带引号的字符串，
 * 不会出现"前端的 double 精度截断"或"term 查询的数值/文本类型不匹配"。
 *
 * <h2>为什么 createdAt 是 epoch 毫秒</h2>
 *
 * 与 {@code PostCreated} 事件、{@code /internal/search/posts} 回填接口同一种表示，
 * mapping 里是 {@code date}，ES 默认接受 {@code epoch_millis}。
 * 用 ISO 字符串则要保证两侧时区一致，多一个出错面。
 *
 * <h2>降级值</h2>
 *
 * {@code authorNickname} 查不到人时是「已注销用户」，{@code communityName}
 * 查不到社群时是空字符串 —— 都不是 null：ES 里 null 字段不参与检索，
 * 而"空社群名"至少能显示成一条没有来源的帖子。
 */
public record PostDocument(
        String postId,
        String communityId,
        String authorId,
        String title,
        String body,
        String authorNickname,
        String communityName,
        long createdAt
) {
}
