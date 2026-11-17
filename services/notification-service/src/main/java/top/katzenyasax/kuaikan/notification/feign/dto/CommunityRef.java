package top.katzenyasax.kuaikan.notification.feign.dto;

/**
 * community-service 内部接口 GET /internal/communities/{id} 的返回体。
 *
 * 只需要名字：消息里存下来才能拼出 `/c/{社群名}/p/{帖子id}`。
 */
public record CommunityRef(boolean exists, String name) {
}
