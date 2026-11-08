package top.katzenyasax.kuaikan.common.api;

import java.util.List;

/**
 * 游标分页结果。禁止使用 offset 分页（architecture §10 不变量 11）。
 *
 * @param items      当前页数据
 * @param nextCursor 下一页游标，为空表示没有下一页
 * @param hasMore    是否还有下一页
 */
public record PageResult<T>(List<T> items, String nextCursor, boolean hasMore) {

    public static <T> PageResult<T> empty() {
        return new PageResult<>(List.of(), null, false);
    }

    public static <T> PageResult<T> of(List<T> items, String nextCursor) {
        return new PageResult<>(items, nextCursor, nextCursor != null);
    }
}
