package top.katzenyasax.kuaikan.search.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.search.config.SearchProperties;
import top.katzenyasax.kuaikan.search.embedding.EmbeddingClient;
import top.katzenyasax.kuaikan.search.es.ChunkSearchHit;
import top.katzenyasax.kuaikan.search.es.ElasticsearchGateway;
import top.katzenyasax.kuaikan.search.service.SearchRebuildService;
import top.katzenyasax.kuaikan.search.web.dto.RebuildResult;

import java.util.List;
import java.util.Locale;

/**
 * 内部运维端点：零停机全量重建索引（p6-search.md §4.3）与 P9.0 检索评测探针。
 *
 * 网关不路由 {@code /internal/**}（InternalPathBlockFilter），所以只能在容器网络内调用，
 * 不需要 {@code @PublicEndpoint}。用 {@code @Hidden}：它不是前端契约的一部分，
 * 不进 OpenAPI spec。
 */
@Hidden
@RestController
@RequestMapping("/internal/admin")
public class InternalAdminController {

    private final SearchRebuildService rebuildService;
    private final ElasticsearchGateway es;
    private final EmbeddingClient embeddingClient;
    private final SearchProperties props;

    public InternalAdminController(SearchRebuildService rebuildService,
                                   ElasticsearchGateway es,
                                   EmbeddingClient embeddingClient,
                                   SearchProperties props) {
        this.rebuildService = rebuildService;
        this.es = es;
        this.embeddingClient = embeddingClient;
        this.props = props;
    }

    @PostMapping("/rebuild")
    public Result<RebuildResult> rebuild(@RequestParam(defaultValue = "POST") String target) {
        String normalized = target == null ? "POST" : target.strip().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "POST" -> Result.ok(rebuildService.rebuild());
            case "POST_CHUNK" -> Result.ok(rebuildService.rebuildPostChunks());
            case "NOTE_CHUNK" -> Result.ok(rebuildService.ensureNoteChunkIndex());
            case "ALL" -> {
                long startedAt = System.currentTimeMillis();
                RebuildResult postRes = rebuildService.rebuild();
                RebuildResult chunkRes = rebuildService.rebuildPostChunks();
                RebuildResult noteRes = rebuildService.ensureNoteChunkIndex();
                yield Result.ok(new RebuildResult(
                        postRes.indexName() + "," + chunkRes.indexName() + "," + noteRes.indexName(),
                        postRes.indexedCount() + chunkRes.indexedCount(),
                        System.currentTimeMillis() - startedAt));
            }
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "target 只能是 POST / POST_CHUNK / NOTE_CHUNK / ALL");
        };
    }

    public record EvalSearchRequest(String query, String mode, Integer limit) {
    }

    @PostMapping("/eval-search")
    public Result<List<ChunkSearchHit>> evalSearch(@RequestBody EvalSearchRequest req) {
        if (req == null || req.query() == null || req.query().isBlank()) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "query 不能为空");
        }
        String query = req.query().strip();
        String mode = req.mode() == null ? "HYBRID" : req.mode().strip().toUpperCase(Locale.ROOT);
        int limit = req.limit() == null || req.limit() <= 0 ? 5 : Math.min(req.limit(), 20);
        return switch (mode) {
            case "BM25" -> Result.ok(es.searchPostChunksBm25(query, List.of(), 30, limit));
            case "VECTOR" -> {
                float[] vec = embeddingClient.embedOne(query);
                yield Result.ok(es.searchPostChunksKnn(vec, List.of(), 30, 60, limit));
            }
            case "HYBRID" -> {
                float[] vec = embeddingClient.embedOne(query);
                yield Result.ok(es.searchPostChunksHybridRrf(
                        query, vec, List.of(), props.getEmbedding().getRrfK(), limit));
            }
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "mode 只能是 BM25 / VECTOR / HYBRID");
        };
    }

    @GetMapping("/eval-related/{postId}")
    public Result<List<ChunkSearchHit>> evalRelated(
            @PathVariable String postId,
            @RequestParam(defaultValue = "5") int limit,
            @RequestParam(defaultValue = "0.0") double minScore) {
        int safeLimit = Math.max(1, Math.min(limit, 20));
        return Result.ok(es.findRelatedPostsByVector(postId, safeLimit, minScore));
    }
}
