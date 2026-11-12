package top.katzenyasax.kuaikan.user.web;

import com.alibaba.csp.sentinel.annotation.SentinelResource;
import com.alibaba.csp.sentinel.slots.block.BlockException;
import org.apache.rocketmq.client.producer.SendResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.user.client.CommunityPingClient;
import top.katzenyasax.kuaikan.user.mq.P0MqProducer;
import top.katzenyasax.kuaikan.user.sentinel.P0SentinelConfig;

import java.net.InetAddress;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/ping")
public class PingController {

    @Value("${spring.application.name}")
    private String serviceName;

    @Value("${server.port}")
    private String port;

    private final CommunityPingClient communityPingClient;
    private final P0MqProducer mqProducer;

    public PingController(CommunityPingClient communityPingClient, P0MqProducer mqProducer) {
        this.communityPingClient = communityPingClient;
        this.mqProducer = mqProducer;
    }

    @Operation(operationId = "userPing")
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

    // ---------------- Feign + Nacos 服务发现 ----------------

    @Operation(operationId = "userFeign")
    @GetMapping("/feign")
    public Result<Map<String, Object>> feign() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("caller", serviceName);
        body.put("protocol", "Feign + Nacos discovery + LoadBalancer");
        body.put("callee", communityPingClient.ping().data());
        return Result.ok(body);
    }

    // ---------------- RocketMQ 收发 ----------------

    /** 发一条消息，返回 traceId；消费者收到后可通过 GET /ping/mq/{traceId} 查证 */
    @Operation(operationId = "userSendMq")
    @PostMapping("/mq")
    public Result<Map<String, Object>> sendMq() throws Exception {
        String traceId = UUID.randomUUID().toString();
        SendResult sendResult = mqProducer.send(traceId);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("traceId", traceId);
        body.put("sendStatus", sendResult.getSendStatus().name());
        body.put("msgId", sendResult.getMsgId());
        body.put("queue", sendResult.getMessageQueue().getQueueId());
        return Result.ok(body);
    }

    /** 通过 Feign 问 community-service：这条消息你收到了吗？ */
    @Operation(operationId = "userMqStatus")
    @GetMapping("/mq/{traceId}")
    public Result<Map<String, Object>> mqStatus(@PathVariable("traceId") String traceId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("traceId", traceId);
        body.put("queried", serviceName + " -> community-service");
        body.put("consumer", communityPingClient.mqStatus(traceId).data());
        return Result.ok(body);
    }

    // ---------------- Sentinel 限流 ----------------

    @Operation(operationId = "userSentinel")
    @GetMapping("/sentinel")
    @SentinelResource(value = P0SentinelConfig.RESOURCE, blockHandler = "sentinelBlocked")
    public ResponseEntity<Result<Map<String, Object>>> sentinel() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("resource", P0SentinelConfig.RESOURCE);
        body.put("qpsLimit", P0SentinelConfig.QPS_LIMIT);
        body.put("time", OffsetDateTime.now().toString());
        return ResponseEntity.ok(Result.ok(body));
    }

    /** 被限流时走这里，返回 429 + 统一响应体，而不是一个裸的 500 */
    public ResponseEntity<Result<Map<String, Object>>> sentinelBlocked(BlockException ex) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Result.fail(CommonErrorCode.RATE_LIMITED));
    }
}
