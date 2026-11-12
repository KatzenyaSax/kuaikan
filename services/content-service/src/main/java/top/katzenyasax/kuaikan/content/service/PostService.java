package top.katzenyasax.kuaikan.content.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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

@Service
public class PostService {

    private static final Logger log = LoggerFactory.getLogger(PostService.class);

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

    public PostDetail getById(Long postId) {
        Post post = postMapper.selectById(postId);
        // 已删除的帖子对外一律"不存在"，不区分 404 与 403 ——
        // 区分了就等于告诉外界"这篇帖子曾经存在"
        if (post == null || Post.STATUS_NORMAL != post.getStatus()) {
            throw new BizException(ContentErrorCode.POST_NOT_FOUND);
        }
        return PostDetail.of(post);
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
