package top.katzenyasax.kuaikan.rank.feign.dto;

/** community `GET /internal/communities/{id}` 的返回体 */
public record CommunityRefView(boolean exists, String name) {
}
