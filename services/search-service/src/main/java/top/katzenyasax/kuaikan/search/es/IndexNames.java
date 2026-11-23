package top.katzenyasax.kuaikan.search.es;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * 索引与别名的名字。
 *
 * <h2>为什么读写两个别名都指向同一个物理索引</h2>
 *
 * 重建时要"写完新索引再原子切"，而日常写入走 {@code post_write}、查询走 {@code post_read}。
 * 两个别名分开，将来才能做「先切读、观察、再切写」的灰度；现在同进同出，
 * 切换仍然是**一次** {@code POST /_aliases}（原子操作），不会出现"读旧写新"的窗口。
 *
 * <h2>为什么物理索引带时间戳</h2>
 *
 * 重建是"新建 + 切换 + 删旧"，而不是清空重灌。旧索引在切换那一刻仍被读请求使用，
 * 名字必须唯一才能共存。
 */
public final class IndexNames {

    /** 查询侧统一读这个别名 */
    public static final String READ_ALIAS = "post_read";

    /** 事件消费写入这个别名 */
    public static final String WRITE_ALIAS = "post_write";

    /** 物理索引前缀：post_v{yyyyMMddHHmmss} */
    public static final String PREFIX = "post_v";

    /** 索引名里的时间戳按北京时间，便于和 MySQL 里的 created_at 对照排查 */
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private static final DateTimeFormatter FORMAT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    public static String physicalIndexNow() {
        return PREFIX + FORMAT.format(java.time.LocalDateTime.now(ZONE));
    }

    private IndexNames() {
    }
}
