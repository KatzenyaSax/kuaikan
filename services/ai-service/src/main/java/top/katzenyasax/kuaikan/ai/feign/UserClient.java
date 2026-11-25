package top.katzenyasax.kuaikan.ai.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

import java.util.List;

@FeignClient(name = Services.USER)
public interface UserClient {

    @PostMapping("/internal/users/batch")
    Result<List<UserNameRow>> batch(@RequestBody BatchUsersReq request);

    record BatchUsersReq(List<String> ids) {}

    record UserNameRow(String id, String nickname) {}
}
