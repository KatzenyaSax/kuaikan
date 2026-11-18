package top.katzenyasax.kuaikan.rank.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 热度的全部可调参数。前缀 {@code kuaikan.rank}。
 *
 * <b>为什么全部配置化</b>：权重与半衰期是**产品参数**，不是工程常量。
 * 它们要能改，而且改完下一轮重建就生效——不需要发版。
 *
 * 用 {@code @ConfigurationProperties} 而不是 {@code @Value}：
 * 这里已经是一棵小树（weights 是嵌套对象），{@code @Value} 绑不了嵌套结构。
 */
@ConfigurationProperties(prefix = "kuaikan.rank")
public class RankProperties {

    /** 重建周期 */
    private Duration rebuildInterval = Duration.ofMinutes(5);

    /** 榜上最多多少条 */
    private int topN = 50;

    /** 低于这个分数不上榜。0 分的帖子占满榜比空榜更糟 */
    private double minScore = 0.5;

    /** 候选窗口 = span × 半衰期 */
    private int candidateSpan = 10;

    private int dayHalfLifeHours = 24;
    private int weekHalfLifeHours = 168;

    private Weights weights = new Weights();

    /** 累计信号（浏览/分享）的额外降权。它们是长尾，不是主力 */
    private double longtailFactor = 0.3;

    public static class Weights {
        private double comment = 5;
        private double favorite = 4;
        private double share = 3;
        private double like = 2;
        private double view = 0.5;

        public double getComment() { return comment; }
        public void setComment(double comment) { this.comment = comment; }
        public double getFavorite() { return favorite; }
        public void setFavorite(double favorite) { this.favorite = favorite; }
        public double getShare() { return share; }
        public void setShare(double share) { this.share = share; }
        public double getLike() { return like; }
        public void setLike(double like) { this.like = like; }
        public double getView() { return view; }
        public void setView(double view) { this.view = view; }
    }

    public Duration getRebuildInterval() { return rebuildInterval; }
    public void setRebuildInterval(Duration rebuildInterval) { this.rebuildInterval = rebuildInterval; }
    public int getTopN() { return topN; }
    public void setTopN(int topN) { this.topN = topN; }
    public double getMinScore() { return minScore; }
    public void setMinScore(double minScore) { this.minScore = minScore; }
    public int getCandidateSpan() { return candidateSpan; }
    public void setCandidateSpan(int candidateSpan) { this.candidateSpan = candidateSpan; }
    public int getDayHalfLifeHours() { return dayHalfLifeHours; }
    public void setDayHalfLifeHours(int dayHalfLifeHours) { this.dayHalfLifeHours = dayHalfLifeHours; }
    public int getWeekHalfLifeHours() { return weekHalfLifeHours; }
    public void setWeekHalfLifeHours(int weekHalfLifeHours) { this.weekHalfLifeHours = weekHalfLifeHours; }
    public Weights getWeights() { return weights; }
    public void setWeights(Weights weights) { this.weights = weights; }
    public double getLongtailFactor() { return longtailFactor; }
    public void setLongtailFactor(double longtailFactor) { this.longtailFactor = longtailFactor; }
}
