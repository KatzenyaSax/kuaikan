package top.katzenyasax.kuaikan.search.es;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriBuilder;
import top.katzenyasax.kuaikan.search.config.SearchProperties;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * 对 ES REST API 的最小封装。
 *
 * <h2>为什么不引官方客户端</h2>
 *
 * 这里用到的端点只有 {@code PUT /{index}}、{@code POST /_aliases}、
 * {@code PUT /{alias}/_doc/{id}}、{@code POST /_bulk}、{@code POST /_update_by_query}、
 * {@code POST /{alias}/_search}、{@code POST /{index}/_refresh}、{@code DELETE /{index}}。
 * 全部是"发一段 JSON、读一段 JSON"，官方客户端的对象模型在这里只增加依赖与版本风险。
 *
 * <h2>失败怎么处理</h2>
 *
 * <b>不吞异常</b>：ES 不可用要能传到 MQ 消费端，让它重投；重建失败要能让调用方看到。
 * 唯一被容忍的是幂等语义上的 404：删一个已经不在的文档、删一个已经不在的索引。
 *
 * <h2>刷新策略</h2>
 *
 * 单文档写入<b>不</b>带 {@code refresh}：默认 1s 的 refresh_interval 已经满足
 * "发帖几秒内能搜到"，而 {@code refresh=wait_for} 会把 ES 的整段 refresh 周期
 * 压到消费线程上，写入越频繁越慢。重建则显式 {@code _refresh}，
 * 因为切别名之前必须让新索引可被搜索。
 *
 * <h2>编码：请求体一律传 byte[]，不传 String</h2>
 *
 * Spring 的 {@code StringHttpMessageConverter} 在请求头没声明 charset 时按
 * <b>ISO-8859-1</b> 编码，中文会变成一串 {@code ?} —— 而且不报错，
 * ES 里存的、搜出来的就是问号（P6.2 实测踩过：社群名 {@code Katzenyasax的小家}
 * 落库成 {@code Katzenyasax???}）。传 {@code byte[]} 由本类自己用 UTF-8 编码，
 * 绕开默认字符集。读响应同理：ES 的 Content-Type 不带 charset，
 * 所以也用 byte[] 自己解 UTF-8。
 */
@Component
public class ElasticsearchGateway {

    private static final Logger log = LoggerFactory.getLogger(ElasticsearchGateway.class);

    /**
     * 索引设置与 mapping（p6-search.md §4.2）。
     *
     * <b>单分片、零副本</b>：单节点集群，副本永远无法分配，只会让 health 卡在 yellow。
     *
     * <b>IK 分词</b>：中文按 ik_max_word 建索引、ik_smart 检索 ——
     * 建索引时尽量多切（召回优先），检索时粗粒度切（精确优先）。
     *
     * <b>nickname / communityName 带 .keyword 子字段</b>：前者要支持按作者名精确过滤，
     * 后者要支持社群筛选；text 字段不能直接做 term 聚合/精确匹配。
     */
    private static final String INDEX_BODY = """
            {
              "settings": {
                "number_of_shards": 1,
                "number_of_replicas": 0
              },
              "mappings": {
                "properties": {
                  "postId":         { "type": "keyword" },
                  "communityId":    { "type": "keyword" },
                  "authorId":       { "type": "keyword" },
                  "title":          { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
                  "body":           { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
                  "authorNickname": {
                    "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart",
                    "fields": { "keyword": { "type": "keyword" } }
                  },
                  "communityName": {
                    "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart",
                    "fields": { "keyword": { "type": "keyword" } }
                  },
                  "createdAt":      { "type": "date" }
                }
              }
            }
            """;

    /**
     * 检索时的字段权重（p6-search.md §5.1）：标题 &gt; 昵称/社群名 &gt; 正文。
     *
     * 标题权重最高是因为搜索框的行为是"找那篇帖子"；正文只用来兜住
     * "记得内容不记得标题"的场景，权重 1 已经能让它进结果集。
     */
    private static final List<String> MULTI_MATCH_FIELDS = List.of(
            "title^3", "authorNickname^2", "communityName^2", "body^1");

    /** 检索只取这些字段：索引文档里就这些，显式列出来免得 mapping 加字段后响应悄悄变大 */
    private static final List<String> SEARCH_SOURCE_FIELDS = List.of(
            "postId", "communityId", "authorId", "title", "body",
            "authorNickname", "communityName", "createdAt");

    /**
     * 高亮占位符：U+E000 / U+E001（Unicode 私有使用区）。
     *
     * <b>绝不用 {@code <mark>}</b>：ES 高亮会把索引里的原文原样带出来，
     * 一旦后端输出 HTML 标签，帖子里写的 {@code <img onerror=...>} 就会跟着进浏览器。
     * 用私有区字符，前端按它切分文本节点与 {@code <mark>} 元素，XSS 面彻底消失。
     */
    public static final String HIGHLIGHT_PRE_TAG = "\uE000";

    public static final String HIGHLIGHT_POST_TAG = "\uE001";

    /** 正文摘要片段长度。与对外 DTO 的"前 160 字摘要"回落保持一致 */
    private static final int BODY_FRAGMENT_SIZE = 160;

    private final RestClient rest;
    private final ObjectMapper json;
    private final SearchProperties props;

    public ElasticsearchGateway(RestClient elasticsearchRestClient,
                                ObjectMapper json,
                                SearchProperties props) {
        this.rest = elasticsearchRestClient;
        this.json = json;
        this.props = props;
    }

    // ------------------------------------------------------------------ 索引与别名

    /** @return 形如 {@code post_v20261123153000} 的新物理索引名 */
    public String newIndexName() {
        return IndexNames.physicalIndexNow();
    }

    /** 别名下挂的物理索引。别名不存在时返回空集合（ES 对不存在的别名回 404） */
    public Set<String> indicesOfAlias(String alias) {
        try {
            String body = decode(rest.get().uri("/_alias/{alias}", alias)
                    .retrieve().body(byte[].class));
            JsonNode root = readTree(body, "查询别名 " + alias);
            Set<String> out = new LinkedHashSet<>();
            root.fieldNames().forEachRemaining(out::add);
            return out;
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() == 404) {
                return Set.of();
            }
            throw wrapped("查询别名 " + alias, e);
        }
    }

    public boolean aliasExists(String alias) {
        return !indicesOfAlias(alias).isEmpty();
    }

    public void createIndex(String index) {
        put("/{index}", index, INDEX_BODY, "创建索引 " + index);
    }

    /** 新建索引后把读写两个别名一起挂上（一次请求，避免只挂上一个的中间态） */
    public void attachAliases(String index) {
        List<Map<String, Object>> actions = new ArrayList<>(2);
        actions.add(addAliasAction(index, IndexNames.READ_ALIAS));
        actions.add(addAliasAction(index, IndexNames.WRITE_ALIAS));
        postJson("/_aliases", Map.of("actions", actions), "绑定别名 " + index);
    }

    /**
     * 原子切换：一次 {@code POST /_aliases} 里移除旧索引的两个别名、挂到新索引。
     *
     * ES 把一次 _aliases 请求当作一个集群状态变更，所以读请求要么全看到旧索引、
     * 要么全看到新索引，不存在"读别名已切、写别名没切"的窗口。
     */
    public void switchAliases(String newIndex, Collection<String> oldIndices) {
        List<Map<String, Object>> actions = new ArrayList<>();
        for (String old : oldIndices) {
            if (old == null || old.equals(newIndex)) {
                continue;
            }
            actions.add(removeAliasAction(old, IndexNames.READ_ALIAS));
            actions.add(removeAliasAction(old, IndexNames.WRITE_ALIAS));
        }
        actions.add(addAliasAction(newIndex, IndexNames.READ_ALIAS));
        actions.add(addAliasAction(newIndex, IndexNames.WRITE_ALIAS));
        postJson("/_aliases", Map.of("actions", actions), "切换别名 -> " + newIndex);
    }

    /** 删除物理索引。尽力而为：清理失败只记 WARN，不影响已经切换成功的读路径 */
    public void deleteIndexQuietly(String index) {
        try {
            rest.delete().uri("/{index}", index).retrieve().toBodilessEntity();
            log.info("已删除旧索引 {}", index);
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() == 404) {
                log.debug("旧索引已不存在 {}", index);
                return;
            }
            log.warn("删除旧索引失败 index={} status={} body={}",
                    index, e.getStatusCode().value(), trimBody(e));
        } catch (Exception e) {
            log.warn("删除旧索引失败 index={} {}", index, e.toString());
        }
    }

    /**
     * 强制刷新。ES 明确拒绕 {@code _refresh} 带 body（会回 400
     * {@code does not support having a body}），所以它走的是无 body 的 POST。
     */
    public void refresh(String index) {
        postNoBody("/{index}/_refresh", index, "刷新索引 " + index);
    }

    // ------------------------------------------------------------------ 文档

    /** 覆盖写：{@code _id = postId}，重复消费同一条事件结果相同（天然幂等） */
    public void indexDocument(String postId, PostDocument doc) {
        String body = write(doc, "序列化索引文档 postId=" + postId);
        put("/{alias}/_doc/{id}", IndexNames.WRITE_ALIAS, postId, body, "写入文档 postId=" + postId);
    }

    /** 删除文档。404 视为成功：删帖事件重复投递时本来就该是这个结果 */
    public void deleteDocument(String postId) {
        try {
            rest.delete().uri("/{alias}/_doc/{id}", IndexNames.WRITE_ALIAS, postId)
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() == 404) {
                log.debug("文档不存在，视为删除成功 postId={}", postId);
                return;
            }
            throw wrapped("删除文档 postId=" + postId, e);
        }
    }

    /**
     * 按 {@code authorId} 批量改写昵称。{@code conflicts=proceed} 让并发写冲突跳过重试，
     * 因为这个改写是"把旧值刷成新值"，冲突的文档本来就会被后续事件或重建修正。
     *
     * @return 实际更新的文档数
     */
    public long updateAuthorNickname(String authorId, String nickname) {
        Map<String, Object> body = Map.of(
                "query", Map.of("term", Map.of("authorId", authorId)),
                "script", Map.of(
                        "lang", "painless",
                        "source", "ctx._source.authorNickname = params.nickname",
                        "params", Map.of("nickname", nickname)));
        String payload = write(body, "序列化昵称更新 authorId=" + authorId);
        String response = postForBody(
                uri -> uri.path("/{alias}/_update_by_query")
                        .queryParam("conflicts", "proceed")
                        .build(IndexNames.WRITE_ALIAS),
                payload, "更新昵称 authorId=" + authorId);
        JsonNode root = readTree(response, "更新昵称响应 authorId=" + authorId);
        JsonNode updated = root.get("updated");
        return updated == null ? 0 : updated.asLong();
    }

    /**
     * 批量写入（{@code _bulk}）。文档里的 {@code _id} 是 postId，所以重跑重建
     * 或重投事件都不会产生重复文档。
     *
     * ES 的 _bulk 即使部分失败也返回 200，所以必须看响应里的 {@code errors}
     * 和每条 item 的 status —— 只看 HTTP 状态码会把"一条都没写进去"当成功。
     */
    public int bulkIndex(String index, List<PostDocument> docs) {
        if (docs.isEmpty()) {
            return 0;
        }
        int written = 0;
        int chunk = Math.max(1, props.getBulkSize());
        for (int from = 0; from < docs.size(); from += chunk) {
            List<PostDocument> slice = docs.subList(from, Math.min(from + chunk, docs.size()));
            written += bulkChunk(index, slice);
        }
        return written;
    }

    private int bulkChunk(String index, List<PostDocument> docs) {
        StringBuilder ndjson = new StringBuilder(docs.size() * 512);
        for (PostDocument doc : docs) {
            ndjson.append("{\"index\":{\"_index\":")
                    .append(quote(index))
                    .append(",\"_id\":")
                    .append(quote(doc.postId()))
                    .append("}}\n")
                    .append(write(doc, "序列化 bulk 文档 postId=" + doc.postId()))
                    .append('\n');
        }

        String response;
        try {
            response = decode(rest.post().uri("/_bulk")
                    .contentType(MediaType.APPLICATION_NDJSON)
                    .body(utf8(ndjson.toString()))
                    .retrieve().body(byte[].class));
        } catch (RestClientResponseException e) {
            throw wrapped("bulk 写入 index=" + index, e);
        }

        JsonNode root = readTree(response, "bulk 响应 index=" + index);
        if (root.path("errors").asBoolean(false)) {
            String reason = firstBulkError(root);
            throw new IllegalStateException("bulk 部分失败 index=" + index
                    + " 写入 " + docs.size() + " 条：" + reason);
        }
        return docs.size();
    }

    private static String firstBulkError(JsonNode root) {
        for (JsonNode item : root.path("items")) {
            JsonNode op = item.path("index");
            if (op.path("status").asInt(200) >= 300) {
                return "_id=" + op.path("_id").asText()
                        + " status=" + op.path("status").asInt()
                        + " " + op.path("error").toString();
            }
        }
        return "（未定位到具体 item）";
    }

    // ------------------------------------------------------------------ 检索

    /**
     * 检索帖子（读 {@code post_read} 别名）。
     *
     * 请求体走 {@link #write} + {@link #utf8}、响应走 {@link #decode}，
     * 与写入路径同一条 UTF-8 通道 —— P6.2 踩过 ISO-8859-1 把中文变成 {@code ?} 的坑，
     * 检索侧同样必须自己管编码。
     *
     * 异常<b>不吞</b>：ES 不可达 / 超时 / 5xx 都以运行时异常冒到 service 层，
     * 由它翻译成受控 50300（不把 {@code connection refused} 之类的裸异常泄露给前端）。
     */
    public PostSearchPage searchPosts(PostSearchQuery query) {
        String payload = write(searchBody(query), "序列化检索请求 sort=" + query.sort().wireName());
        String response = postForBody(
                uri -> uri.path("/{index}/_search").build(IndexNames.READ_ALIAS),
                payload, "检索帖子 sort=" + query.sort().wireName());
        return parseSearchResponse(response, query);
    }

    private static Map<String, Object> searchBody(PostSearchQuery query) {
        Map<String, Object> bool = new LinkedHashMap<>();
        if (query.keyword() != null && !query.keyword().isEmpty()) {
            bool.put("must", List.of(Map.of("multi_match", Map.of(
                    "query", query.keyword(),
                    "fields", MULTI_MATCH_FIELDS,
                    "type", "best_fields"))));
        }
        if (!query.filters().isEmpty()) {
            bool.put("filter", query.filters());
        }

        Map<String, Object> body = new LinkedHashMap<>();
        // 多取一条判 hasMore，省掉一次没人会看的 count
        body.put("size", query.limit() + 1);
        body.put("track_total_hits", false);
        body.put("query", Map.of("bool", bool));
        body.put("sort", sortClauses(query.sort()));
        body.put("_source", SEARCH_SOURCE_FIELDS);
        if (!query.searchAfter().isEmpty()) {
            body.put("search_after", query.searchAfter());
        }
        if (query.highlight()) {
            body.put("highlight", Map.of(
                    "pre_tags", List.of(HIGHLIGHT_PRE_TAG),
                    "post_tags", List.of(HIGHLIGHT_POST_TAG),
                    "fields", Map.of(
                            // 标题整段返回（0 片段），前端要的是完整标题而不是标题里的一小截
                            "title", Map.of("number_of_fragments", 0),
                            // 正文只要一段 160 字的最佳片段，整篇正文进列表响应会膨胀几十倍
                            "body", Map.of(
                                    "fragment_size", BODY_FRAGMENT_SIZE,
                                    "number_of_fragments", 1))));
        }
        return body;
    }

    private static List<Map<String, Object>> sortClauses(SearchSort sort) {
        Map<String, Object> byCreatedAt = Map.of("createdAt", Map.of("order", "desc"));
        Map<String, Object> byPostId = Map.of("postId", Map.of("order", "desc"));
        if (sort == SearchSort.RELEVANCE) {
            return List.of(Map.of("_score", Map.of("order", "desc")), byCreatedAt, byPostId);
        }
        return List.of(byCreatedAt, byPostId);
    }

    private PostSearchPage parseSearchResponse(String response, PostSearchQuery query) {
        JsonNode root = readTree(response, "检索响应");
        JsonNode rawHits = root.path("hits").path("hits");

        List<PostSearchHit> hits = new ArrayList<>(Math.min(query.limit(), rawHits.size()));
        for (JsonNode hit : rawHits) {
            if (hits.size() >= query.limit()) {
                break;
            }
            JsonNode source = hit.path("_source");
            JsonNode highlight = hit.path("highlight");
            hits.add(new PostSearchHit(
                    text(source, "postId"),
                    text(source, "communityId"),
                    text(source, "communityName"),
                    text(source, "authorId"),
                    text(source, "authorNickname"),
                    text(source, "title"),
                    // body 总是取回：对内 includeBody=false 时也要靠它拼 excerpt，
                    // 是否对外暴露由 service 层决定
                    text(source, "body"),
                    firstHighlight(highlight, "title"),
                    firstHighlight(highlight, "body"),
                    source.path("createdAt").asLong(0L),
                    hit.path("sort")));
        }
        return new PostSearchPage(hits, rawHits.size() > query.limit());
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static String firstHighlight(JsonNode highlight, String field) {
        JsonNode fragments = highlight.path(field);
        if (!fragments.isArray() || fragments.isEmpty()) {
            return null;
        }
        String text = fragments.get(0).asText();
        return text == null || text.isBlank() ? null : text;
    }

    // ------------------------------------------------------------------ HTTP 原语

    private void put(String uriTemplate, Object uriVar, String body, String what) {
        try {
            rest.put().uri(uriTemplate, uriVar)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(utf8(body))
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException e) {
            throw wrapped(what, e);
        }
    }

    /** 两个路径变量的版本（写文档用） */
    private void put(String uriTemplate, Object alias, Object id, String body, String what) {
        try {
            rest.put().uri(uriTemplate, alias, id)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(utf8(body))
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException e) {
            throw wrapped(what, e);
        }
    }

    /**
     * 无 body 的 POST。{@code _refresh} 这类端点带 body 会被 ES 直接拒掉
     * （400 {@code does not support having a body}），所以不能固定发 {@code {}}。
     */
    private void postNoBody(String uriTemplate, Object uriVar, String what) {
        try {
            rest.post().uri(uriTemplate, uriVar)
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException e) {
            throw wrapped(what, e);
        }
    }

    /** 带 JSON body、没有路径变量的 POST（{@code /_aliases}） */
    private void postJson(String uriTemplate, Object body, String what) {
        String payload = write(body, what);
        postForBody(uriTemplate, payload, what);
    }

    /** 无路径变量、带任意 URI 构造器的 POST（{@code _update_by_query?conflicts=proceed}） */
    private String postForBody(String uriTemplate, String body, String what) {
        try {
            return decode(rest.post().uri(uriTemplate)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(utf8(body))
                    .retrieve().body(byte[].class));
        } catch (RestClientResponseException e) {
            throw wrapped(what, e);
        }
    }

    private String postForBody(Function<UriBuilder, URI> uri,
                               String body, String what) {
        try {
            return decode(rest.post().uri(uri)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(utf8(body))
                    .retrieve().body(byte[].class));
        } catch (RestClientResponseException e) {
            throw wrapped(what, e);
        }
    }

    private String write(Object value, String what) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("序列化失败：" + what, e);
        }
    }

    private JsonNode readTree(String body, String what) {
        try {
            return json.readTree(body == null ? "{}" : body);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("解析 ES 响应失败：" + what, e);
        }
    }

    private static String quote(String raw) {
        return "\"" + raw.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /** 请求体：自己编码 UTF-8，不交给 StringHttpMessageConverter（它会用 ISO-8859-1） */
    private static byte[] utf8(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** 响应体：ES 的 Content-Type 不带 charset，同样自己按 UTF-8 解 */
    private static String decode(byte[] raw) {
        return raw == null ? "{}" : new String(raw, StandardCharsets.UTF_8);
    }

    private static IllegalStateException wrapped(String what, RestClientResponseException e) {
        return new IllegalStateException(what + " 失败：HTTP " + e.getStatusCode().value()
                + " " + trimBody(e), e);
    }

    private static String trimBody(RestClientResponseException e) {
        String body = e.getResponseBodyAsString();
        if (body == null) {
            return "";
        }
        String flat = body.strip().replace('\n', ' ');
        return flat.length() <= 300 ? flat : flat.substring(0, 300) + "…";
    }

    private static Map<String, Object> addAliasAction(String index, String alias) {
        return Map.of("add", Map.of("index", index, "alias", alias));
    }

    private static Map<String, Object> removeAliasAction(String index, String alias) {
        return Map.of("remove", Map.of("index", index, "alias", alias));
    }
}
