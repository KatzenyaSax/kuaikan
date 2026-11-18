package top.katzenyasax.kuaikan.content.service;

import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.content.domain.Post;
import top.katzenyasax.kuaikan.content.mapper.CommentMapper;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;
import top.katzenyasax.kuaikan.content.web.dto.RankCandidate;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 给 rank-service 提供候选帖。
 *
 * <h2>为什么只回答 content 自己的事实</h2>
 *
 * 评论在本地，所以窗口内新增评论数在这里算。点赞与收藏是 interaction 的事实，
 * 由 rank 另外去要——**一个服务只回答自己的事实**，不替别人转述。
 * （这是 ADR 0006 的直接后果：content 连 interaction 的表都读不到。）
 *
 * <h2>为什么用两次查询而不是一次 JOIN</h2>
 *
 * 候选集一页最多 100 条，第二次查询是 `WHERE post_id IN (...)` 的聚合，
 * 走 `idx_post_created` 很快。写成 JOIN + GROUP BY 会让主查询变复杂，
 * 而且 UNION 里套聚合在 MySQL 上很容易走偏。
 */
@Service
public class RankCandidateService {

    /** 一页最多取多少。rank 会循环拉，这个数决定每次往返的批大小 */
    private static final int MAX_LIMIT = 100;
    private static final int DEFAULT_LIMIT = 50;

    private final PostMapper postMapper;
    private final CommentMapper commentMapper;

    public RankCandidateService(PostMapper postMapper, CommentMapper commentMapper) {
        this.postMapper = postMapper;
        this.commentMapper = commentMapper;
    }

    /**
     * @param sinceMillis 候选窗口起点（epoch 毫秒）。按"半衰期的若干倍"算，不由本方法决定
     * @param cursor      上一页最后一个 postId；首页传 null
     */
    public List<RankCandidate> candidates(long sinceMillis, Long cursor, Integer limit) {
        int size = normalizeLimit(limit);
        LocalDateTime since = LocalDateTime.ofInstant(Instant.ofEpochMilli(sinceMillis),
                ZoneId.systemDefault());

        List<Post> posts = postMapper.rankCandidates(since, cursor, size);
        if (posts.isEmpty()) {
            return List.of();
        }

        List<Long> ids = new ArrayList<>(posts.size());
        for (Post p : posts) {
            ids.add(p.getId());
        }
        Map<Long, Long> recentComments = new HashMap<>();
        for (CommentMapper.PostCommentCount row : commentMapper.recentCommentCounts(ids, since)) {
            recentComments.put(row.postId(), row.cnt());
        }

        List<RankCandidate> out = new ArrayList<>(posts.size());
        for (Post p : posts) {
            out.add(new RankCandidate(
                    p.getId(),
                    p.getTitle(),
                    p.getAuthorId(),
                    p.getCommunityId(),
                    nz(p.getLikeCount()),
                    nz(p.getFavoriteCount()),
                    nz(p.getCommentCount()),
                    nz(p.getViewCount()),
                    nz(p.getShareCount()),
                    recentComments.getOrDefault(p.getId(), 0L),
                    p.getLastInteractionAt(),
                    p.getCreatedAt()));
        }
        return out;
    }

    private static long nz(Integer v) {
        return v == null ? 0 : v;
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }
}
