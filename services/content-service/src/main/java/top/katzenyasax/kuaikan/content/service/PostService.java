package top.katzenyasax.kuaikan.content.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.CommunityErrorCode;
import top.katzenyasax.kuaikan.common.error.ContentErrorCode;
import top.katzenyasax.kuaikan.content.domain.Post;
import top.katzenyasax.kuaikan.content.feign.CommunityMembershipClient;
import top.katzenyasax.kuaikan.content.feign.MembershipView;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;
import top.katzenyasax.kuaikan.content.web.dto.CreatePostRequest;
import top.katzenyasax.kuaikan.content.web.dto.PostDetail;
import top.katzenyasax.kuaikan.content.web.dto.PostPage;
import top.katzenyasax.kuaikan.content.web.dto.PostSummary;

@Service
public class PostService {

    private static final Logger log = LoggerFactory.getLogger(PostService.class);

    /** 排序标记，编进游标。P5 若加热度排序，各排序各自解释自己的游标 */
    private static final String SORT_NEW = "post-new";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final PostMapper postMapper;
    private final CommunityMembershipClient membershipClient;

    public PostService(PostMapper postMapper, CommunityMembershipClient membershipClient) {
        this.postMapper = postMapper;
        this.membershipClient = membershipClient;
    }

    /**
     * 发帖。
     *
     * 唯一一次写路径跨服务调用：问 community-service 要成员关系的**权威答案**。
     * 这不是"抄别人的数据"，是"问别人的数据"——不问就判不了，所以这个依赖是
     * 必要的（ADR 0009 里辨析过这两者的区别）。
     *
     * 调用失败一律 50300：宁可发帖失败，也不要让"不确定是不是成员"的人发出去。
     */
    @Transactional
    public PostDetail create(Long userId, CreatePostRequest req) {
        requireMembership(req.communityId(), userId);

        Post post = new Post();
        post.setCommunityId(req.communityId());
        // 作者只来自 UserContext，请求体里根本没有这个字段
        post.setAuthorId(userId);
        post.setTitle(req.title().trim());
        post.setBody(req.body());
        post.setStatus(Post.STATUS_NORMAL);
        postMapper.insert(post);

        log.info("帖子已发布 id={} communityId={} authorId={}",
                post.getId(), post.getCommunityId(), userId);
        return PostDetail.of(post);
    }

    /** 全站最新帖。首页"最新帖子"用，游客可读 */
    public List<PostSummary> listLatest(Integer limit) {
        return postMapper.latestPosts(normalizeLimit(limit)).stream().map(PostSummary::of).toList();
    }

    public PostDetail getById(Long postId) {
        Post post = postMapper.selectById(postId);
        // 已删除的帖子对外一律"不存在"，不区分 404 与 403 ——
        // 区分了就等于告诉外界"这篇帖子曾经存在"
        if (post == null || Post.STATUS_NORMAL != post.getStatus()) {
            throw new BizException(ContentErrorCode.POST_NOT_FOUND);
        }
        return PostDetail.of(post);
    }

    /**
     * 记一次分享，返回新的分享数。
     *
     * 直接 UPDATE 而不是走 Redis 缓冲：分享是低频动作（一次点击一次写），
     * 没有浏览那种"热点帖每秒几千次"的问题。**不要为了统一而统一**。
     */
    @org.springframework.transaction.annotation.Transactional
    public long recordShare(Long postId) {
        // 先确认帖子存在：给一个不存在的 id 加 1 是无意义的写
        getById(postId);
        postMapper.incrementShareCount(postId);
        Post fresh = postMapper.selectById(postId);
        return fresh == null || fresh.getShareCount() == null ? 0 : fresh.getShareCount();
    }

    /**
     * 社群时间线。按发布时间倒序，游标分页。
     *
     * P2 只实现 {@code sort=new}，其他值**明确拒绝**（40010）而不是静默降级：
     * 静默降级会把 bug 藏起来，P5 上线热度排序时无法证明它真的生效了。
     *
     * 翻页的正确性靠游标的复合键：单列时间戳在"翻页过程中有人发帖"时
     * 会重复或跳过。verify-p2.sh 的 L2 有一条专门造这个场景的断言。
     */
    public PostPage list(Long communityId, String sort, String cursor, Integer limit) {
        String effectiveSort = (sort == null || sort.isBlank()) ? "new" : sort;
        if (!"new".equals(effectiveSort)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "暂不支持该排序方式");
        }
        int size = normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_NEW);

        // 多取一条用来判断有没有下一页，省掉一次 count 查询
        List<Post> rows = (c == null)
                ? postMapper.firstPage(communityId, size + 1)
                : postMapper.pageAfter(communityId,
                        LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()),
                                ZoneId.systemDefault()),
                        c.id(), size + 1);

        List<PostSummary> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(PostSummary.of(rows.get(i)));
        }
        String next = null;
        if (rows.size() > size) {
            Post last = rows.get(size - 1);
            next = CursorCodec.encode(SORT_NEW,
                    last.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
                    last.getId());
        }
        return new PostPage(items, next);
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private void requireMembership(Long communityId, Long userId) {
        Result<MembershipView> result;
        try {
            result = membershipClient.membership(communityId, userId);
        } catch (Exception e) {
            // 超时、连接拒绝、下游 5xx 全在这里。不重试：重试会把 500ms 变成 1.5s，
            // 而后端服务不可用时重试的收益为零、代价是线程被多占两倍时间。
            log.error("成员校验失败 communityId={} userId={}", communityId, userId, e);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE);
        }
        if (result == null || result.data() == null) {
            log.error("成员校验返回空 body communityId={} userId={}", communityId, userId);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE);
        }
        MembershipView view = result.data();
        if (!view.exists()) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NOT_FOUND);
        }
        if (!view.member()) {
            throw new BizException(CommunityErrorCode.NOT_MEMBER);
        }
    }
}
