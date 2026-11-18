package top.katzenyasax.kuaikan.rank.service;

import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.rank.config.RankProperties;

/**
 * 热度公式。**纯函数，不碰任何 IO。**
 *
 * <pre>
 *   recent   = w_comment·log2(1+C_win) + w_fav·log2(1+F_win) + w_like·log2(1+L_win)
 *   longtail = w_share·log2(1+S_total) + w_view·log2(1+V_total)
 *   raw      = recent + LONGTAIL_FACTOR · longtail
 *   score    = raw · 0.5 ^ (距最后互动的小时数 / H)
 * </pre>
 *
 * <h2>为什么每个因子取 log2</h2>
 *
 * 各因子量级根本不可比：一篇帖可能 800 浏览、3 条评论。任何让浏览量有意义的
 * 线性权重都会让浏览量主导排序。log 带来量级归一 + 边际递减（抑制刷量）
 * + 以后加新因子不用重新平衡。
 *
 * <h2>为什么强信号用增量、弱信号用累计</h2>
 *
 * 纯累计 + 衰减会让"30 天前攒够 200 赞、昨天只被赞一次"的老帖压过新爆款。
 * 所以评论/赞/收藏走窗口增量。而浏览与分享**没有按天存**，算增量要加每日清零任务，
 * 那是给自己造对账问题——所以它们走累计并额外乘 longtailFactor，标注为长尾信号。
 *
 * <h2>为什么衰减基准是 lastInteractionAt</h2>
 *
 * 用 createdAt 等于老帖永无翻身；用最后互动时间等于"每次互动把帖子重新点燃"，
 * 这本身就是活跃度的近似，不需要真算增速。
 */
@Component
public class HeatFormula {

    private final RankProperties props;

    public HeatFormula(RankProperties props) {
        this.props = props;
    }

    /**
     * @param recentCommentCount 窗口内新增评论
     * @param likeDelta          窗口内新增点赞
     * @param favoriteDelta      窗口内新增收藏
     * @param shareCount         累计分享
     * @param viewCount          累计浏览
     * @param hoursSinceLastInteraction 距最后一次互动的小时数（负数按 0 处理）
     * @param halfLifeHours      半衰期
     */
    public double score(long recentCommentCount, long likeDelta, long favoriteDelta,
                        long shareCount, long viewCount,
                        double hoursSinceLastInteraction, int halfLifeHours) {
        RankProperties.Weights w = props.getWeights();

        double recent = w.getComment() * log2(1 + recentCommentCount)
                + w.getFavorite() * log2(1 + favoriteDelta)
                + w.getLike() * log2(1 + likeDelta);
        double longtail = w.getShare() * log2(1 + shareCount)
                + w.getView() * log2(1 + viewCount);
        double raw = recent + props.getLongtailFactor() * longtail;

        double age = Math.max(0, hoursSinceLastInteraction);
        return raw * Math.pow(0.5, age / halfLifeHours);
    }

    /** log2(1+x)。x<=0 时返回 0，避免 log2(0) = -Infinity */
    static double log2(double x) {
        return x <= 1 ? 0 : Math.log(x) / Math.log(2);
    }
}
