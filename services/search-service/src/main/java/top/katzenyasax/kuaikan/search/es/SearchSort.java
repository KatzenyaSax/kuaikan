package top.katzenyasax.kuaikan.search.es;

/**
 * 两种检索排序。枚举名就是对外契约里的取值（{@code relevance} / {@code latest}），
 * 不另设映射表 —— 契约与实现之间多一层转换就多一处能写错的地方。
 *
 * <h2>为什么要带 {@link #sortValueCount()}</h2>
 *
 * {@code search_after} 的位置由整个排序子句决定：相关性排序是
 * {@code [_score, createdAt, postId]} 三段，最新排序是 {@code [createdAt, postId]} 两段。
 * 游标里存的就是上一次命中的 {@code sort} 数组，段数必须和排序方式对得上：
 * 拿两段的游标去喂三段排序（或反过来）会翻出一段"看起来正常、实际乱序"的数据，
 * 比直接报 40010 难查得多。所以段数要跟着枚举走，而不是散在游标解码那一处。
 *
 * <h2>为什么 relevance 也要带 createdAt / postId</h2>
 *
 * 只按 {@code _score} 排序时分数并列的文档顺序是不确定的，翻页必然重复或丢数据。
 * 复合排序是游标分页正确性的前提（architecture §10 不变量 11）。
 */
public enum SearchSort {

    /** 相关性：{@code [_score desc, createdAt desc, postId desc]} */
    RELEVANCE("relevance", 3),

    /** 最新：{@code [createdAt desc, postId desc]} */
    LATEST("latest", 2);

    private final String wireName;
    private final int sortValueCount;

    SearchSort(String wireName, int sortValueCount) {
        this.wireName = wireName;
        this.sortValueCount = sortValueCount;
    }

    public String wireName() {
        return wireName;
    }

    /** {@code _search} 响应里 {@code hits[].sort} 的段数，也等于游标载荷长度 */
    public int sortValueCount() {
        return sortValueCount;
    }

    /**
     * @return 匹配的排序；未知取值返回 {@code null}（由调用方决定是报 40010 还是用默认值）
     */
    public static SearchSort fromWireName(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.strip();
        for (SearchSort sort : values()) {
            if (sort.wireName.equals(value)) {
                return sort;
            }
        }
        return null;
    }
}
