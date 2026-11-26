package top.katzenyasax.kuaikan.search.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.search.config.SearchProperties;
import top.katzenyasax.kuaikan.search.embedding.EmbeddingClient;
import top.katzenyasax.kuaikan.search.es.ChunkSearchHit;
import top.katzenyasax.kuaikan.search.es.ElasticsearchGateway;
import top.katzenyasax.kuaikan.search.es.NoteChunkSearchHit;
import top.katzenyasax.kuaikan.search.es.PostSearchHit;
import top.katzenyasax.kuaikan.search.es.PostSearchPage;
import top.katzenyasax.kuaikan.search.es.PostSearchQuery;
import top.katzenyasax.kuaikan.search.es.SearchSort;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchNoteItem;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchNotesRequest;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchPostItem;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchPostsRequest;
import top.katzenyasax.kuaikan.search.web.dto.RelatedPostItem;
import top.katzenyasax.kuaikan.search.web.dto.SearchPostItem;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 双面检索（p6-search.md §5）：对外面向用户，对内面向系统 / 未来 AI 助手。
 *
 * <h2>为什么两条接口放在一个 service 而不是两个</h2>
 *
 * 它们共用同一套东西：参数归一化（排序、limit、游标）、ES 查询构造、
 * hasMore / nextCursor 的收尾、以及**同一份降级语义**。真正不同的只有两处：
 * 多了哪些过滤条件，以及结果里给不给全文。拆成两个类会让这些共用部分
 * 各抄一遍，然后在下一次改游标格式时只改到一半。
 *
 * <h2>降级：ES 挂了就是这个接口挂了</h2>
 *
 * search-service 没有数据库、没有第二存储，ES 不可达时**没有**"退化为 SQL 查询"
 * 这条路径。所以这里的策略是明确的受控失败：
 * {@code 50300 / UPSTREAM_UNAVAILABLE} → HTTP 503，文案是给人看的，
 * 不把 {@code Connection refused} 之类的裸异常抛给前端（那既无用又是信息泄露）。
 * 唯一被放行的是本层自己抛的 {@link BizException}（40010 参数错误），
 * 它不是 ES 的问题，不能被翻译成 503。
 *
 * <h2>高亮的回落是产品决策，放在这一层</h2>
 *
 * 网关只如实上报"有没有高亮片段"。这里才决定：标题没命中高亮就用原标题，
 * 正文没命中高亮就用正文摘要 —— 前端拿到的两个字段**永远可渲染**，
 * 不需要为"搜索页的某一条恰好没高亮"写分支。
 */
@Service
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    /** 对外 limit 默认值 / 上限（p6-search.md §5.1） */
    private static final int PUBLIC_DEFAULT_LIMIT = 20;
    private static final int PUBLIC_MAX_LIMIT = 50;

    /** 对内 limit 默认值 / 上限（p6-search.md §5.2） */
    private static final int INTERNAL_DEFAULT_LIMIT = 20;
    private static final int INTERNAL_MAX_LIMIT = 100;

    /** 关键词上限。给 IK 的查询串不能无限长：超长串会切出几千个 term，变成一次拒绝服务 */
    private static final int MAX_KEYWORD_LENGTH = 100;

    /** 摘要长度：与 ES 高亮片段的 fragment_size 对齐 */
    private static final int SNIPPET_LENGTH = 160;
    private static final String ELLIPSIS = "…";

    /** 雪花 id 的字面形状。19 位十进制；不认负号、空格、科学计数法 */
    private static final Pattern SNOWFLAKE = Pattern.compile("^[0-9]{1,19}$");

    private final ElasticsearchGateway es;
    private final SearchCursorCodec cursorCodec;
    private final EmbeddingClient embeddingClient;
    private final SearchProperties props;

    public SearchService(ElasticsearchGateway es,
                         SearchCursorCodec cursorCodec,
                         EmbeddingClient embeddingClient,
                         SearchProperties props) {
        this.es = es;
        this.cursorCodec = cursorCodec;
        this.embeddingClient = embeddingClient;
        this.props = props;
    }

    // ------------------------------------------------------------------ 对外

    /**
     * 对外检索。游客可读。
     *
     * @param q           关键词，必填（trim 后 1~100 字）
     * @param communityId 可选，社群过滤
     * @param sort        {@code relevance}（默认）| {@code latest}
     * @param cursor      上一页的 {@code nextCursor}
     * @param limit       默认 20，上限 50
     */
    public PageResult<SearchPostItem> searchPosts(String q, String communityId, String sort,
                                                  String cursor, Integer limit) {
        String keyword = requireKeyword(q);
        SearchSort searchSort = parseSort(sort, SearchSort.RELEVANCE);
        String communityIdValue = parseSnowflake(communityId, "社群 id");
        int size = clampLimit(limit, PUBLIC_DEFAULT_LIMIT, PUBLIC_MAX_LIMIT);

        // 先解游标再做任何 IO：非法游标必须在本服务就报 40010，
        // 不能先去问一次 ES、再把结果丢掉
        List<JsonNode> searchAfter = cursorCodec.decode(cursor, searchSort);

        List<Map<String, Object>> filters = new ArrayList<>();
        if (communityIdValue != null) {
            filters.add(Map.of("term", Map.of("communityId", communityIdValue)));
        }

        PostSearchPage page = execute(new PostSearchQuery(
                searchSort, keyword, filters, searchAfter, size, true));

        List<SearchPostItem> items = page.hits().stream().map(hit -> new SearchPostItem(
                hit.postId(),
                hit.communityId(),
                hit.communityName(),
                hit.authorId(),
                hit.authorNickname(),
                hit.title(),
                // 未命中高亮时回落到原字段：前端不需要处理 null
                hit.titleHighlight() != null ? collapse(hit.titleHighlight()) : collapse(hit.title()),
                hit.bodySnippet() != null ? collapse(hit.bodySnippet()) : excerpt(hit.body()),
                toLocalDateTime(hit.createdAt()))).toList();

        return PageResult.of(items, nextCursor(page, searchSort));
    }

    /**
     * P9.1 相关帖子推荐（游客可读，基于既有帖子向量 kNN，不调用 TEI）。
     * ES 异常或尚未建索引时静默返回空列表，绝不影响帖子详情页渲染。
     */
    public List<RelatedPostItem> relatedPosts(String postId, Integer limit) {
        String safePostId = parseSnowflake(postId, "postId");
        if (safePostId == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "postId 不能为空");
        }
        int size = clampLimit(limit, 5, 10);
        try {
            List<ChunkSearchHit> hits = es.findRelatedPostsByVector(
                    safePostId, size, props.getEmbedding().getRelatedMinScore());
            return hits.stream()
                    .map(h -> new RelatedPostItem(
                            h.postId(),
                            h.communityId(),
                            h.communityName(),
                            h.authorId(),
                            h.authorNickname(),
                            h.title(),
                            h.createdAt(),
                            h.score()))
                    .toList();
        } catch (RuntimeException e) {
            log.warn("相关帖子推荐降级为空 postId={} reason={}", safePostId, e.toString());
            return List.of();
        }
    }

    // ------------------------------------------------------------------ 对内

    /**
     * 对内检索。条件全部可空（空条件 = 按 {@code latest} 遍历全站最新帖）。
     */
    public PageResult<InternalSearchPostItem> searchPostsInternal(InternalSearchPostsRequest request) {
        if (request == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "请求体不能为空");
        }
        String keyword = optionalKeyword(request.keyword());
        String authorId = parseSnowflake(request.authorId(), "authorId");
        String communityId = parseSnowflake(request.communityId(), "communityId");
        String authorNickname = blankToNull(request.authorNickname());
        String communityName = blankToNull(request.communityName());
        Long createdFrom = parseTimestamp(request.createdFrom(), "createdFrom");
        Long createdTo = parseTimestamp(request.createdTo(), "createdTo");

        if (createdFrom != null && createdTo != null && createdFrom > createdTo) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "createdFrom 不能晚于 createdTo");
        }

        // 没有关键词时 relevance 没有意义（_score 恒为 1，等价于按 createdAt 排），
        // 所以默认落到 latest；显式传 relevance 仍然尊重调用方，不做静默改写。
        SearchSort searchSort = parseSort(request.sort(),
                keyword == null ? SearchSort.LATEST : SearchSort.RELEVANCE);
        int size = clampLimit(request.limit(), INTERNAL_DEFAULT_LIMIT, INTERNAL_MAX_LIMIT);
        List<JsonNode> searchAfter = cursorCodec.decode(request.cursor(), searchSort);
        boolean includeBody = Boolean.TRUE.equals(request.includeBody());

        List<Map<String, Object>> filters = new ArrayList<>();
        if (authorId != null) {
            filters.add(Map.of("term", Map.of("authorId", authorId)));
        }
        if (communityId != null) {
            filters.add(Map.of("term", Map.of("communityId", communityId)));
        }
        if (authorNickname != null) {
            filters.add(textOrKeyword("authorNickname", authorNickname));
        }
        if (communityName != null) {
            filters.add(textOrKeyword("communityName", communityName));
        }
        if (createdFrom != null || createdTo != null) {
            filters.add(rangeFilter(createdFrom, createdTo));
        }
        if (request.postIds() != null) {
            if (request.postIds().isEmpty()) {
                return PageResult.of(List.of(), null);
            }
            List<String> safeIds = new ArrayList<>(request.postIds().size());
            for (String pid : request.postIds()) {
                String parsed = parseSnowflake(pid, "postIds");
                if (parsed != null) {
                    safeIds.add(parsed);
                }
            }
            if (safeIds.isEmpty()) {
                return PageResult.of(List.of(), null);
            }
            filters.add(Map.of("terms", Map.of("postId", safeIds)));
        }

        boolean tryHybrid = keyword != null
                && !"BM25".equalsIgnoreCase(request.mode())
                && searchSort == SearchSort.RELEVANCE
                && (request.cursor() == null || request.cursor().isBlank());
        if (tryHybrid) {
            try {
                float[] vec = embeddingClient.embedOne(keyword);
                List<ChunkSearchHit> hybridHits = es.searchPostChunksHybridRrf(
                        keyword, vec, filters, props.getEmbedding().getRrfK(), size);
                List<InternalSearchPostItem> items = hybridHits.stream().map(hit -> {
                    String cleanChunk = stripTitlePrefix(hit.chunkText());
                    return new InternalSearchPostItem(
                            hit.postId(),
                            hit.communityId(),
                            hit.communityName(),
                            hit.authorId(),
                            hit.authorNickname(),
                            hit.title(),
                            includeBody ? hit.chunkText() : null,
                            excerpt(cleanChunk),
                            hit.createdAt());
                }).toList();
                return PageResult.of(items, null);
            } catch (RuntimeException e) {
                log.warn("混合检索降级为纯 BM25 keyword={} reason={}", keyword, e.toString());
            }
        }

        PostSearchPage page = execute(new PostSearchQuery(
                searchSort, keyword, filters, searchAfter, size, false));

        List<InternalSearchPostItem> items = page.hits().stream().map(hit -> new InternalSearchPostItem(
                hit.postId(),
                hit.communityId(),
                hit.communityName(),
                hit.authorId(),
                hit.authorNickname(),
                hit.title(),
                includeBody ? hit.body() : null,
                excerpt(hit.body()),
                hit.createdAt())).toList();

        return PageResult.of(items, nextCursor(page, searchSort));
    }

    /** P9.3 对内个人私密笔记混合检索（强制按 ownerId 硬隔离） */
    public List<InternalSearchNoteItem> searchNotesInternal(InternalSearchNotesRequest request) {
        if (request == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "请求体不能为空");
        }
        String ownerId = parseSnowflake(request.ownerId(), "ownerId");
        if (ownerId == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "ownerId 不能为空");
        }
        String query = requireKeyword(request.query());
        int size = clampLimit(request.limit(), 5, 8);
        try {
            float[] vec = embeddingClient.embedOne(query);
            List<NoteChunkSearchHit> hits = es.searchNoteChunksHybridRrf(
                    ownerId, query, vec, props.getEmbedding().getRrfK(), size);
            return hits.stream()
                    .map(h -> new InternalSearchNoteItem(
                            h.noteId(),
                            h.title(),
                            excerpt(stripTitlePrefix(h.chunkText())),
                            h.score(),
                            h.updatedAt()))
                    .toList();
        } catch (BizException e) {
            throw e;
        } catch (RuntimeException e) {
            log.warn("笔记语义检索失败 ownerId={} reason={}", ownerId, e.toString());
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE, "个人知识库语义检索暂不可用");
        }
    }

    private static String stripTitlePrefix(String chunkText) {
        if (chunkText == null) {
            return "";
        }
        if (chunkText.startsWith("标题：")) {
            int nl = chunkText.indexOf('\n');
            if (nl >= 0 && nl + 1 < chunkText.length()) {
                return chunkText.substring(nl + 1);
            }
        }
        return chunkText;
    }

    /**
     * P9.1 相关帖子推荐（游客可读，基于既有帖子向量 kNN，不调用 TEI）。
     * ES 异常或尚未建索引时静默返回空列表，绝不影响帖子详情页渲染。
     */
    public List<RelatedPostItem> relatedPosts(String postId, Integer limit) {
        String safePostId = parseSnowflake(postId, "postId");
        if (safePostId == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "postId 不能为空");
        }
        int size = clampLimit(limit, 5, 10);
        try {
            List<ChunkSearchHit> hits = es.findRelatedPostsByVector(
                    safePostId, size, props.getEmbedding().getRelatedMinScore());
            return hits.stream()
                    .map(h -> new RelatedPostItem(
                            h.postId(),
                            h.communityId(),
                            h.communityName(),
                            h.authorId(),
                            h.authorNickname(),
                            h.title(),
                            h.createdAt(),
                            h.score()))
                    .toList();
        } catch (RuntimeException e) {
            log.warn("相关帖子推荐降级为空 postId={} reason={}", safePostId, e.toString());
            return List.of();
        }
    }

    // ------------------------------------------------------------------ ES 调用与降级

    private PostSearchPage execute(PostSearchQuery query) {
        try {
            return es.searchPosts(query);
        } catch (BizException e) {
            throw e;
        } catch (RuntimeException e) {
            // ES 不可达 / 超时 / 5xx / 响应解析失败：统一受控 503。
            // 详情只进日志（排查要原因），不进响应（既无用又是信息泄露）。
            log.warn("检索降级为 50300：sort={} keyword={} 原因={}",
                    query.sort().wireName(), query.keyword(), e.toString(), e);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE, "搜索服务暂时不可用，请稍后重试");
        }
    }

    private String nextCursor(PostSearchPage page, SearchSort sort) {
        if (!page.hasMore() || page.hits().isEmpty()) {
            return null;
        }
        return cursorCodec.encode(sort, page.hits().get(page.hits().size() - 1).sortValues());
    }

    // ------------------------------------------------------------------ 参数归一化

    private static String requireKeyword(String q) {
        String keyword = q == null ? "" : q.strip();
        if (keyword.isEmpty() || keyword.codePointCount(0, keyword.length()) > MAX_KEYWORD_LENGTH) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "q 不能为空且长度不能超过 " + MAX_KEYWORD_LENGTH + " 字");
        }
        return keyword;
    }

    private static String optionalKeyword(String raw) {
        String keyword = raw == null ? "" : raw.strip();
        if (keyword.isEmpty()) {
            return null;
        }
        if (keyword.codePointCount(0, keyword.length()) > MAX_KEYWORD_LENGTH) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "keyword 长度不能超过 " + MAX_KEYWORD_LENGTH + " 字");
        }
        return keyword;
    }

    private static String blankToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.strip();
        return value.isEmpty() ? null : value;
    }

    /** 未知排序值明确拒绝（40010），不静默降级 —— 降级会把调用方的 bug 藏起来 */
    private static SearchSort parseSort(String raw, SearchSort fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        SearchSort sort = SearchSort.fromWireName(raw);
        if (sort == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "sort 只能是 relevance 或 latest");
        }
        return sort;
    }

    /**
     * 雪花 id 校验。返回规范化后的字符串（去掉前导零、拒绝溢出）。
     * 空值合法（表示不过滤），格式非法抛 40010。
     */
    private static String parseSnowflake(String raw, String field) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.strip();
        if (!SNOWFLAKE.matcher(value).matches()) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, field + " 必须是雪花 id 字符串");
        }
        try {
            return String.valueOf(Long.parseLong(value));
        } catch (NumberFormatException e) {
            // 19 位但超过 Long.MAX_VALUE
            throw new BizException(CommonErrorCode.PARAM_INVALID, field + " 必须是雪花 id 字符串");
        }
    }

    /**
     * limit 归一化：越界**收敛**而不是报错。
     *
     * 与 content-service 的 {@code normalizeLimit} 一致：limit 是"工具性参数"，
     * 前端把 20 传成 200 时返回 50 条比返回 40010 更有用，
     * 而分页正确性由游标保证，不受它影响。
     */
    private static int clampLimit(Integer limit, int fallback, int max) {
        if (limit == null || limit <= 0) {
            return fallback;
        }
        return Math.min(limit, max);
    }

    /**
     * epoch 毫秒或 ISO-8601（{@code 2026-01-01T00:00:00Z} / 带偏移的 {@code +08:00}）。
     *
     * 纯数字必须先试 → 时间戳里不会再出现冒号，不会和 ISO 混淆。
     * 不带时区的 {@code 2026-01-01T00:00:00} 也接受（按本服务时区，容器里是 Asia/Shanghai）：
     * 人写这种格式时想的就是"本地时间"，硬要求写 Z 只会让 curl 试错。
     */
    private static Long parseTimestamp(String raw, String field) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.strip();
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ignored) {
            // 不是 epoch 毫秒，继续按 ISO-8601 试
        }
        try {
            return OffsetDateTime.parse(value).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // 再试一次不带时区的
        }
        try {
            return LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (DateTimeParseException e) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    field + " 必须是 epoch 毫秒或 ISO-8601 时间");
        }
    }

    // ------------------------------------------------------------------ 过滤子句构造

    /**
     * 昵称 / 社群名：先按 {@code .keyword} 精确，再按分词字段模糊。
     *
     * 用户的直觉是"我输入的就是那个名字"，所以精确命中必须排在最前（should 里
     * 前一条的权重更高，用 boost 表达）；同时允许"输入名字的一部分"也能查到。
     * 两条都不中才算不匹配（{@code minimum_should_match=1}）。
     */
    private static Map<String, Object> textOrKeyword(String field, String value) {
        return Map.of("bool", Map.of(
                "should", List.of(
                        Map.of("term", Map.of(field + ".keyword", Map.of("value", value, "boost", 2.0))),
                        Map.of("match", Map.of(field, value))),
                "minimum_should_match", 1));
    }

    private static Map<String, Object> rangeFilter(Long from, Long to) {
        Map<String, Object> bounds = new LinkedHashMap<>(2);
        if (from != null) {
            bounds.put("gte", from);
        }
        if (to != null) {
            bounds.put("lte", to);
        }
        return Map.of("range", Map.of("createdAt", bounds));
    }

    // ------------------------------------------------------------------ 展示层小工具

    /**
     * 正文摘要：折叠空白后按<b>码点</b>截 160 字。
     *
     * 用码点而不是 {@code char}：emoji / 生僻字是代理对，按 char 截断
     * 会切出半个字符（前端显示成 {@code ?}）。列表页的文本看着像乱码，
     * 排查时又几乎不可能想到是分页裁剪的问题。
     */
    private static String excerpt(String body) {
        if (body == null || body.isBlank()) {
            return "";
        }
        String flat = collapse(body);
        if (flat.codePointCount(0, flat.length()) <= SNIPPET_LENGTH) {
            return flat;
        }
        return flat.substring(0, flat.offsetByCodePoints(0, SNIPPET_LENGTH)) + ELLIPSIS;
    }

    /** 折叠换行与连续空白：摘要要在一行里显示，原文的缩进与空行没有意义 */
    private static String collapse(String text) {
        if (text == null) {
            return null;
        }
        return text.strip().replaceAll("\\s+", " ");
    }

    /** ES 里 {@code createdAt} 是 epoch 毫秒（date），对外按 ISO-8601 本地时间给 */
    private static LocalDateTime toLocalDateTime(long epochMillis) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ZoneId.systemDefault());
    }
}
