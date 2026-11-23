package top.katzenyasax.kuaikan.search.feign.dto;

import java.util.List;

/**
 * user {@code POST /internal/users/batch} 的请求体。
 *
 * id 用字符串：雪花 id 超出 JS 安全整数范围，全站 id 一律字符串。
 * 服务端上限 200，本服务按 200 分片（见 {@code DirectoryService}）。
 */
public record BatchUsersRequest(List<String> ids) {
}
