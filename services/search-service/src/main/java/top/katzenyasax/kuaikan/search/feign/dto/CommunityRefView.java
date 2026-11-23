package top.katzenyasax.kuaikan.search.feign.dto;

/**
 * community {@code GET /internal/communities/{id}} 的返回体。
 *
 * {@code exists=false} 表示社群不存在或已删除 —— 不是错误，
 * 索引里降级为空字符串（帖子仍然可搜，只是不显示来源）。
 */
public record CommunityRefView(boolean exists, String name) {
}
