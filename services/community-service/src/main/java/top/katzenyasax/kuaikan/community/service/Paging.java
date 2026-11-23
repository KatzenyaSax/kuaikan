package top.katzenyasax.kuaikan.community.service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 游标分页的公共算术。
 *
 * 三件事在全服务的每个列表里都必须一致，抄一份就会有一份抄错：
 *
 *   1. **limit 归一**：缺省 / 非正数走默认值，过大截到上限。
 *      「不超过 50」是契约（architecture §10），不能在某个新端点上悄悄放宽。
 *   2. **游标毫秒 ↔ 库里的 DATETIME(3)**：游标里存的是 epoch 毫秒，库里是
 *      {@link LocalDateTime}。转换必须用同一个 zone（{@code Asia/Shanghai}，
 *      容器 TZ 与 JDBC serverTimezone 都钉住了）。
 *   3. **截到毫秒**：库里只存到毫秒，写入时不截断会导致"接口返回的时间"与
 *      "再读回来的时间"不相等（P2 踩过，见 docs/project.md）。
 *
 * 与 {@link top.katzenyasax.kuaikan.common.api.CursorCodec} 分工：
 * 那个只负责载荷的编解码与排序标记校验，不知道任何时间语义。
 */
final class Paging {

    static final int DEFAULT_LIMIT = 20;
    static final int MAX_LIMIT = 50;

    static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    /** 游标里的毫秒 → 可直接与 DATETIME(3) 列比较的时间 */
    static LocalDateTime fromMillis(long millis) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), ZoneId.systemDefault());
    }

    /** DATETIME(3) 列 → 游标里的毫秒 */
    static long toMillis(LocalDateTime ts) {
        return ts.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    private Paging() {
    }
}
