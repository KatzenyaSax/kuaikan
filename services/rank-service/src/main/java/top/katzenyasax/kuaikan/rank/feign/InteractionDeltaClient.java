package top.katzenyasax.kuaikan.rank.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.rank.feign.dto.SinceRequestView;
import top.katzenyasax.kuaikan.rank.feign.dto.SinceResponseView;

import java.util.List;

/**
 * 内部：窗口内新增的赞/收藏。
 *
 * 用 POST 而不是 GET：一次上百个 id 塞 query string 会撞请求头上限。
 */
@FeignClient(name = "interaction-service", path = "/internal")
public interface InteractionDeltaClient {

    @PostMapping("/counts/since")
    Result<List<SinceResponseView>> since(@RequestBody SinceRequestView req);
}
