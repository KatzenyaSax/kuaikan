package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 热榜候选帖。rank-service 重建时拉取。
 *
 * <b>这是内部接口的返回，不是给前端的。</b>它一次给全 rank 需要的一切，
 * 让重建过程只跟 content 打一次交道，而不是按字段回来问很多次。
 *
 * 字段分三类：
 * <ul>
 *   <li><b>窗口增量</b>：{@code recentCommentCount} —— 评论在本地，直接算。
 *       点赞/收藏的增量在 interaction 那边，rank 另外去要（一个服务只回答自己的事实）</li>
 *   <li><b>累计值</b>：{@code viewCount} / {@code shareCount} —— 只有累计，没有按天分布。
 *       所以它们在公式里被降权为长尾信号（见 p5-rank.md §2.2）</li>
 *   <li><b>衰减基准</b>：{@code lastInteractionAt} —— 热度用它而不是 createdAt</li>
 * </ul>
 */
public record RankCandidate(
        @Schema(type = "string") Long postId,
        String title,
        @Schema(type = "string") Long authorId,
        @Schema(type = "string", description = "社群 id。名字由 rank 另行解析并缓存") Long communityId,
        long likeCount,
        long favoriteCount,
        long commentCount,
        long viewCount,
        long shareCount,
        @Schema(description = "窗口内新增评论数") long recentCommentCount,
        @Schema(description = "最后一次互动时刻，热度的衰减基准") LocalDateTime lastInteractionAt,
        LocalDateTime createdAt
) {
}
