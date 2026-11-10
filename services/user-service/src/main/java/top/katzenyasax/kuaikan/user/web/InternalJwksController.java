package top.katzenyasax.kuaikan.user.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.user.auth.RsaKeyProvider;

/**
 * 公钥分发。只在容器网络内可见 —— 网关不路由 /internal/**（P0.5 的 InternalPathBlockFilter 强制）。
 *
 * 网关按 kid 缓存这里的结果，遇到未知 kid 再刷新一次，从而支持密钥轮换。
 */
@Hidden
@RestController
@RequestMapping("/internal")
public class InternalJwksController {

    private final RsaKeyProvider keyProvider;

    public InternalJwksController(RsaKeyProvider keyProvider) {
        this.keyProvider = keyProvider;
    }

    @GetMapping(value = "/jwks", produces = MediaType.APPLICATION_JSON_VALUE)
    public String jwks() {
        return keyProvider.jwksJson();
    }
}
