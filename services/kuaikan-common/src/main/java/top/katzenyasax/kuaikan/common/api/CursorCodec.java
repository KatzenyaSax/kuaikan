package top.katzenyasax.kuaikan.common.api;

import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * 不透明游标编解码。
 *
 * 载荷是 {@code 排序标记:毫秒时间戳:雪花id}，整体 base64url。**前端不许解析、不许拼**，
 * 只做原样回传。
 *
 * 为什么带排序标记：P5 的热度排序需要"浮点分数 + 打破平局"，游标形状与时间排序不同。
 * 把排序标记编进游标，跨排序复用游标时就能**明确报错**（40010），而不是静默按错误的
 * 排序解释同一个游标、跳出一段看似正常实际乱序的数据。
 *
 * 为什么用冒号分隔而不是 JSON：本类在 kuaikan-common 里，这个模块刻意零第三方依赖。
 * 载荷只有三个定长片段，不需要 JSON。
 *
 * 解码失败一律当参数错误（40010），不是 500 —— 游标是用户可改的输入。
 */
public final class CursorCodec {

    /** 解出来的游标（时间序，载荷三段） */
    public record Cursor(String sort, long timestampMillis, long id) {
    }

    /**
     * 解出来的游标（分数序，载荷四段）。
     *
     * 时间序只需要 (created_at, id) 两段就能唯一定位，
     * 而分数序需要 (score, created_at, id) 三段——score 是会并列的，
     * 必须再拿创建时间和 id 打破平局，否则翻页会重复或跳过。
     */
    public record ScoredCursor(String sort, long score, long timestampMillis, long id) {
    }

    public static String encode(String sort, long timestampMillis, long id) {
        String raw = sort + ":" + timestampMillis + ":" + id;
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 解码并校验排序标记。
     *
     * @param raw            客户端回传的游标；null 或空表示"第一页"
     * @param expectedSort   本次请求的排序标记
     * @throws BizException 游标非法或与本次排序不匹配时抛 PARAM_INVALID
     */
    public static Cursor decode(String raw, String expectedSort) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String[] parts = split(raw);
        if (parts.length != 3) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标无效");
        }
        if (!expectedSort.equals(parts[0])) {
            // 明确拒绝，不静默降级：跨排序复用游标本身就是调用方写错了
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标与排序方式不匹配");
        }
        try {
            return new Cursor(parts[0], Long.parseLong(parts[1]), Long.parseLong(parts[2]));
        } catch (NumberFormatException e) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标无效");
        }
    }

    /**
     * 分数序游标。载荷 {@code 排序标记:分数:毫秒时间戳:雪花id}。
     *
     * 分数用 long 而不是 double：热度分数是 `like_count + reply_count` 这种整数，
     * 不需要浮点精度，也不需要科学计数法（那会让载荷出现 `1.0E-5` 这种解析陷阱）。
     */
    public static String encodeScored(String sort, long score, long timestampMillis, long id) {
        String raw = sort + ":" + score + ":" + timestampMillis + ":" + id;
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 解码分数序游标。
     *
     * <b>段数必须正好是 4</b>：三段的游标（时间序）如果喂给分数序接口，
     * 这里会明确拒绝而不是把 id 当分数用——那样跳出来的是一段
     * "看起来正常实际乱序"的数据，比报错难查得多。
     */
    public static ScoredCursor decodeScored(String raw, String expectedSort) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String[] parts = split(raw);
        if (parts.length != 4) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标无效");
        }
        if (!expectedSort.equals(parts[0])) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标与排序方式不匹配");
        }
        try {
            return new ScoredCursor(parts[0], Long.parseLong(parts[1]),
                    Long.parseLong(parts[2]), Long.parseLong(parts[3]));
        } catch (NumberFormatException e) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标无效");
        }
    }

    private static String[] split(String raw) {
        String decoded;
        try {
            decoded = new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "游标无效");
        }
        return decoded.split(":");
    }

    private CursorCodec() {
    }
}
