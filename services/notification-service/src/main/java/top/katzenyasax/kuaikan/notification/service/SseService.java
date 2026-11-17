package top.katzenyasax.kuaikan.notification.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * SSE 长连接注册表与推送。
 *
 * <h2>SSE 是「提示通道」，不是「投递通道」</h2>
 *
 * 消息的真相在 MySQL。这里只负责让红点及时亮。
 * <b>断线期间的消息不补发</b>——重连后前端重新拉一次未读数和第一页即可。
 *
 * 不这么定位的话就会去做 {@code Last-Event-ID} 补发、ACK、重投……
 * 那是在重新实现一个消息队列，而消息本来就已经可靠地存好了。
 *
 * <h2>单实例的已知限制</h2>
 *
 * 连接存在本进程的 Map 里。多实例部署时，用户连在 A 实例上、
 * 事件在 B 实例上被消费，推送就会落空——需要 Redis pub/sub 转一层。
 * <b>P4 是单实例</b>，先不做；这条写在这里，免得以后有人以为它能直接水平扩容。
 */
@Service
public class SseService {

    private static final Logger log = LoggerFactory.getLogger(SseService.class);

    /** 30 分钟。客户端断开后由浏览器自动重连，服务端不需要长时间挂着一个死连接 */
    private static final long EMITTER_TIMEOUT_MS = 30 * 60 * 1000L;

    /** 心跳间隔。必须小于网关与 nginx 的读超时（都是 3600s，这里留足余量） */
    private static final long HEARTBEAT_MS = 15_000L;

    private final Map<Long, Set<SseEmitter>> emitters = new ConcurrentHashMap<>();

    /**
     * 建立连接。
     *
     * @param tokenExpEpochSecond 由网关注入的 {@code X-Token-Exp}；null 表示不确定
     */
    public SseEmitter subscribe(Long userId, Long tokenExpEpochSecond) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        emitters.computeIfAbsent(userId, k -> new CopyOnWriteArraySet<>()).add(emitter);

        Runnable cleanup = () -> {
            Set<SseEmitter> set = emitters.get(userId);
            if (set != null) {
                set.remove(emitter);
                if (set.isEmpty()) {
                    emitters.remove(userId);
                }
            }
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        try {
            // 首帧：让客户端的 fetch 流立刻拿到字节，否则某些代理会一直等到超时
            emitter.send(SseEmitter.event().name("connected").data(String.valueOf(userId)));
        } catch (IOException e) {
            cleanup.run();
            throw new IllegalStateException("SSE 首帧发送失败", e);
        }

        scheduleTokenExpiry(userId, emitter, tokenExpEpochSecond, cleanup);
        log.info("SSE 已连接 userId={} 当前连接数={}", userId, emitters.getOrDefault(userId, Set.of()).size());
        return emitter;
    }

    /**
     * token 到点主动断流。
     *
     * <b>为什么要自己断</b>：网关只在**建立连接时**验一次 JWT。
     * 连接建立之后那个 token 就算过期了也没人管，于是会留下一个
     * "还连着、但已经是个无主连接"的 SSE——服务端持续给它推消息，
     * 而用户可能已经登出或换了账号。
     *
     * 发一个 {@code expired} 事件再 complete，让客户端带着新 token 重连。
     */
    private void scheduleTokenExpiry(Long userId, SseEmitter emitter,
                                    Long tokenExpEpochSecond, Runnable cleanup) {
        if (tokenExpEpochSecond == null) {
            return;
        }
        long delayMs = tokenExpEpochSecond * 1000L - System.currentTimeMillis();
        if (delayMs <= 0) {
            expire(emitter, cleanup);
            return;
        }
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(delayMs);
                expire(emitter, cleanup);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                log.debug("SSE token 断流任务异常 userId={} {}", userId, e.toString());
            }
        }, "sse-exp-" + userId);
        t.setDaemon(true);
        t.start();
    }

    private void expire(SseEmitter emitter, Runnable cleanup) {
        try {
            emitter.send(SseEmitter.event().name("expired").data("token"));
        } catch (Exception ignored) {
            // 对端已经走了，正常
        }
        try {
            emitter.complete();
        } catch (Exception ignored) {
            // 同上
        }
        cleanup.run();
    }

    /**
     * 心跳。
     *
     * 注释帧（`: ping`）不触发 EventSource 的 message 事件，
     * 但能让 TCP 连接保持活跃，避免中间设备把空闲连接掐掉。
     */
    @Scheduled(fixedRate = HEARTBEAT_MS)
    public void heartbeat() {
        emitters.forEach((userId, set) -> {
            for (SseEmitter emitter : set) {
                try {
                    emitter.send(SseEmitter.event().comment("ping"));
                } catch (Exception e) {
                    // 发不出去说明连接已断，摘掉即可。不要在这里重试：
                    // 前端重连后会自己拉一次未读数，不需要服务端补偿。
                    set.remove(emitter);
                    if (set.isEmpty()) {
                        emitters.remove(userId);
                    }
                }
            }
        });
    }

    /**
     * 推一条新消息的提醒。
     *
     * 只推"有新消息"这个信号，不推消息内容——内容由客户端主动拉。
     * 这样即使推送体丢了，也只是红点晚一点亮，而不是显示出错误的内容。
     */
    public void pushNewMessage(Long userId, String messageId, String type) {
        Set<SseEmitter> set = emitters.get(userId);
        if (set == null || set.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : set) {
            try {
                emitter.send(SseEmitter.event()
                        .name("message")
                        .data(Map.of("id", messageId, "type", type)));
            } catch (Exception e) {
                set.remove(emitter);
                if (set.isEmpty()) {
                    emitters.remove(userId);
                }
            }
        }
    }
}
