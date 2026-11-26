package top.katzenyasax.kuaikan.search.config;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.search.service.PostIndexService;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 启动自检：确认 {@code post_read} / {@code post_write} 别名存在，不在就建首个索引。
 *
 * <h2>为什么在 ApplicationReadyEvent 里异步做</h2>
 *
 * ES 可能比本服务晚启动（compose 里 search-service 刻意 <b>不</b>依赖 ES，
 * 见 p6-search.md §2：ES 挂了不能把 search-service 一起拖死）。
 * 同步等待会让启动卡在 ES 的超时上，而 readiness 并不需要 ES ——
 * 自检失败只记 WARN，首次写入或 rebuild 会再试一次。
 *
 * <h2>为什么用独立线程而不是 @Async</h2>
 *
 * 只需要一个后台任务，不值得为它打开 Spring 的异步代理，
 * 还要担心 {@code @Async} 在同类调用里失效的坑。
 */
@Component
public class IndexBootstrap {

    private static final Logger log = LoggerFactory.getLogger(IndexBootstrap.class);

    private final PostIndexService postIndexService;

    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "search-index-bootstrap");
        t.setDaemon(true);
        return t;
    });

    public IndexBootstrap(PostIndexService postIndexService) {
        this.postIndexService = postIndexService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void bootstrap() {
        executor.execute(() -> {
            try {
                postIndexService.ensureReady();
                postIndexService.ensurePostChunkReady();
                postIndexService.ensureNoteChunkReady();
                log.info("ES 索引自检通过（含 P9 向量切片索引）");
            } catch (Exception e) {
                // ES 不可用是允许的状态：服务照常活着，只是索引暂时不可写
                log.warn("ES 索引自检失败，服务继续运行（首次写入 / rebuild 时会再试）：{}", e.toString());
            }
        });
    }

    @PreDestroy
    public void stop() {
        executor.shutdownNow();
    }
}
