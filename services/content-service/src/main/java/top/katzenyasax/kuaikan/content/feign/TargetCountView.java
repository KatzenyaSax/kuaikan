package top.katzenyasax.kuaikan.content.feign;

/** interaction 内部接口 GET /internal/counts 的返回体（content 侧对下游契约的独立描述） */
public record TargetCountView(String targetType, Long targetId, long likeCount, long favoriteCount) {
}
