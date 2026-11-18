package top.katzenyasax.kuaikan.rank.feign.dto;

import java.util.List;

/** interaction `POST /internal/counts/since` 的请求体 */
public record SinceRequestView(String targetType, long since, List<String> targetIds) {
}
