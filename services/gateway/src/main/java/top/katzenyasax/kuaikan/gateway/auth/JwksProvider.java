package top.katzenyasax.kuaikan.gateway.auth;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 按 kid 缓存公钥。
 *
 * 不硬编码公钥：user-service 换密钥时网关要能自动跟上。
 * 遇到不认识的 kid 就重新拉一次 JWKS（这就是密钥轮换的机制）。
 *
 * **拉不到公钥时必须失败，不能放行** —— 这是安全路径与业务路径的根本区别。
 */
@Component
public class JwksProvider {

    private static final Logger log = LoggerFactory.getLogger(JwksProvider.class);

    private final WebClient webClient;
    private final String jwksUri;
    private final Map<String, RSAKey> cache = new ConcurrentHashMap<>();

    public JwksProvider(WebClient.Builder builder,
                        @Value("${kuaikan.auth.jwks-uri:http://user-service:8081/internal/jwks}") String jwksUri) {
        this.webClient = builder.build();
        this.jwksUri = jwksUri;
    }

    /**
     * 取 kid 对应的公钥。缓存未命中时刷新一次。
     *
     * @return 找不到则 empty（调用方应返回 401）
     */
    public Mono<RSAKey> keyFor(String kid) {
        if (kid == null || kid.isBlank()) {
            return Mono.empty();
        }
        RSAKey cached = cache.get(kid);
        if (cached != null) {
            return Mono.just(cached);
        }
        return refresh().flatMap(loaded -> {
            RSAKey key = loaded.get(kid);
            return key == null ? Mono.empty() : Mono.just(key);
        });
    }

    private Mono<Map<String, RSAKey>> refresh() {
        return webClient.get()
                .uri(jwksUri)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(3))
                .map(body -> {
                    try {
                        JWKSet set = JWKSet.parse(body);
                        Map<String, RSAKey> loaded = new ConcurrentHashMap<>();
                        for (JWK jwk : set.getKeys()) {
                            if (jwk instanceof RSAKey rsaKey && rsaKey.getKeyID() != null) {
                                loaded.put(rsaKey.getKeyID(), rsaKey);
                            }
                        }
                        if (loaded.isEmpty()) {
                            throw new IllegalStateException("JWKS 里没有可用的 RSA 公钥");
                        }
                        cache.putAll(loaded);
                        log.info("已刷新 JWKS kids={}", loaded.keySet());
                        return loaded;
                    } catch (Exception e) {
                        throw new IllegalStateException("解析 JWKS 失败: " + e.getMessage(), e);
                    }
                });
    }
}
