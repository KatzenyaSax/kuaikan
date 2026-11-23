package top.katzenyasax.kuaikan.search.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.feign.dto.InternalSearchPostItemView;

/**
 * content-service 的内部全量拉帖（P6.1）。零停机重建的唯一数据源。
 *
 * <b>路径是 {@code /internal/search/posts}（无 {@code /api/content} 前缀）</b>：
 * Feign 走 Nacos 直连，不经网关；网关的 {@code StripPrefix=2} 在这里不生效。
 * 照抄前端路径会得到 500 + {@code NoResourceFoundException}。
 *
 * <b>游标由 content 编码，本服务只原样回传</b>：游标的载荷是
 * {@code 排序标记:毫秒:雪花id}，跨列表复用会被 content 明确拒绝（40010），
 * 所以这里绝不做解析或拼接。
 */
@FeignClient(name = "content-service", path = "/internal/search")
public interface ContentIndexClient {

    @GetMapping("/posts")
    Result<PageResult<InternalSearchPostItemView>> posts(
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam("limit") int limit);
}
