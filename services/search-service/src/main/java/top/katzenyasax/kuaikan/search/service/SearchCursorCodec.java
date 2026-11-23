package top.katzenyasax.kuaikan.search.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.search.es.SearchSort;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 检索游标：{@code Base64url({"s":"relevance","v":[<search_after 分量>...]})}。
 *
 * <h2>为什么不能复用 {@code CursorCodec}</h2>
 *
 * {@code kuaikan-common} 里的那份载荷是 {@code 排序标记:毫秒:雪花id}，面向 SQL 的
 * {@code (created_at, id)} 复合键。ES 的 {@code search_after} 是**排序子句的原样回放**：
 * 相关性排序的分量里还有 {@code _score}，是个浮点数，且将来加字段时形状还会变。
 * 硬塞进冒号分隔的三段格式，就等于把"ES 排序"这件事锁死在 SQL 的形状上。
 *
 * <h2>为什么存 JSON 而不是自己拼字符串</h2>
 *
 * 分量要保持类型：分数是数值、{@code postId} 在 mapping 里是 {@code keyword}（字符串）。
 * 自定义分隔符迟早会遇到值里含分隔符或浮点格式差异（{@code 1.0E-5}），
 * JSON 的解析与保真都由 Jackson 保证。
 *
 * <h2>校验比"能不能解开"更严</h2>
 *
 * 解不开 → 40010；排序标记不匹配 → 40010；分量个数与排序方式不符 → 40010。
 * 游标是用户可以随手改的输入，**一律当参数错误，不能是 500**。
 * 段数校验是排序标记校验之外的第二道闸：将来两种排序的分量个数恰好相同也不会误判，
 * 而现在（3 段 vs 2 段）能挡住"拿 latest 的游标去翻 relevance"这种脏用法。
 */
@Component
public class SearchCursorCodec {

    private static final String SORT_FIELD = "s";
    private static final String VALUES_FIELD = "v";

    private final ObjectMapper json;

    public SearchCursorCodec(ObjectMapper json) {
        this.json = json;
    }

    /** @param sortValues 上一页最后一条命中的 {@code hits[].sort} 数组 */
    public String encode(SearchSort sort, JsonNode sortValues) {
        ObjectNode payload = json.createObjectNode();
        payload.put(SORT_FIELD, sort.wireName());
        payload.set(VALUES_FIELD, sortValues == null ? json.createArrayNode() : sortValues);
        try {
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(json.writeValueAsBytes(payload));
        } catch (JsonProcessingException e) {
            // 编码失败是本服务的 bug（JSON 已经在内存里），不是调用方的问题
            throw new IllegalStateException("游标序列化失败", e);
        }
    }

    /**
     * @param raw      调用方回传的游标；null/空白表示第一页
     * @param expected 本次请求的排序方式
     * @return {@code search_after} 分量；第一页返回空列表
     * @throws BizException 游标非法或与本次排序不匹配（40010）
     */
    public List<JsonNode> decode(String raw, SearchSort expected) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        JsonNode payload;
        try {
            payload = json.readTree(Base64.getUrlDecoder().decode(raw.strip()));
        } catch (IOException | IllegalArgumentException e) {
            throw invalid();
        }
        if (payload == null || !payload.isObject()) {
            throw invalid();
        }
        if (!expected.wireName().equals(payload.path(SORT_FIELD).asText(""))) {
            // 明确拒绝，不静默降级：跨排序复用游标本身就是调用方写错了
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标与排序方式不匹配");
        }
        JsonNode values = payload.path(VALUES_FIELD);
        if (!values.isArray() || values.size() != expected.sortValueCount()) {
            throw invalid();
        }
        List<JsonNode> out = new ArrayList<>(values.size());
        values.forEach(out::add);
        return out;
    }

    private static BizException invalid() {
        return new BizException(CommonErrorCode.PARAM_INVALID, "游标无效");
    }
}
