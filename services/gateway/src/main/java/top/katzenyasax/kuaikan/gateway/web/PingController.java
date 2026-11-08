package top.katzenyasax.kuaikan.gateway.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/ping")
public class PingController {

    @Value("${spring.application.name}")
    private String serviceName;

    @Value("${server.port}")
    private String port;

    @GetMapping
    public Mono<Map<String, Object>> ping() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", serviceName);
        body.put("port", port);
        body.put("runtime", "webflux");
        body.put("time", OffsetDateTime.now().toString());
        return Mono.just(body);
    }
}
