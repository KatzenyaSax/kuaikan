package top.katzenyasax.kuaikan.search.web;

import org.springframework.beans.factory.annotation.Value;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;

import java.net.InetAddress;
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

    @Operation(operationId = "searchPing")
    @GetMapping
    public Result<Map<String, Object>> ping() throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", serviceName);
        body.put("port", port);
        body.put("host", InetAddress.getLocalHost().getHostName());
        body.put("java", System.getProperty("java.version"));
        body.put("time", OffsetDateTime.now().toString());
        return Result.ok(body);
    }
}
