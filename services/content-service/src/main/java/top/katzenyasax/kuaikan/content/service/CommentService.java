package top.katzenyasax.kuaikan.content.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.CommunityErrorCode;
import top.katzenyasax.kuaikan.common.error.ContentErrorCode;
import top.katzenyasax.kuaikan.content.domain.Comment;
import top.katzenyasax.kuaikan.content.domain.Post;
import top.katzenyasax.kuaikan.content.feign.CommunityMembershipClient;
import top.katzenyasax.kuaikan.content.feign.MembershipView;
import top.katzenyasax.kuaikan.content.mapper.CommentMapper;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;
import top.katzenyasax.kuaikan.content.web.dto.CommentPage;
import top.katzenyasax.kuaikan.content.web.dto.CommentView;
import top.katzenyasax.kuaikan.content.web.dto.CreateCommentRequest;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * 评论。
 *
 * 两类计数的差别在这一层最明显：
 *   - {@code post.comment_count} 与 {@code root.reply_count} 是**强一致**，
 *     和评论的插入/删除在同一个本地事务里（事实与计数同库，没有跨服务的必要）
 *   - {@code comment.like_count} 是**最终一致**，由 P3.2 的事件投影写入，这里不碰
 */
@Service
public class CommentService {

    private static final Logger log = LoggerFactory.getLogger(CommentService.class);

    /**
     * 游标排序标记。**每个列表必须不同**：一级评论与回复列表的形状不同，
     * 共用一个标记的话，拿错列表的游标会被静默解析成错误结果。
     */
    private static final String SORT_TOP = "comment-top";
    private static final String SORT_REPLIES = "comment-replies";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final CommentMapper commentMapper;
    private final PostMapper postMapper;
    private final CommunityMembershipClient membershipClient;

    public CommentService(CommentMapper commentMapper,
                          PostMapper postMapper,
                          CommunityMembershipClient membershipClient) {
        this.commentMapper = commentMapper;
        this.postMapper = postMapper;
        this.membershipClient = membershipClient;
    }

    /**
     * 发评论 / 回复。
     *
     * 必须走一遍成员校验：与发帖同一套权限语义。否则"能评论但不能发帖"很怪，
     * 而且给刷评论留了口子。代价是一次跨服务调用，失败一律 50300。
     */
    @Transactional
    public CommentView create(Long userId, Long postId, CreateCommentRequest req) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getStatus() != Post.STATUS_NORMAL) {
            throw new BizException(ContentErrorCode.POST_NOT_FOUND);
        }
        requireMembership(post.getCommunityId(), userId);

        Comment comment = new Comment();
        comment.setPostId(postId);
        comment.setAuthorId(userId);
        comment.setBody(req.body().trim());
        comment.setLikeCount(0);
        comment.setReplyCount(0);
        comment.setStatus(Comment.STATUS_NORMAL);

        Long rootId = null;
        if (req.replyToCommentId() != null) {
            Comment parent = commentMapper.selectById(req.replyToCommentId());
            // 父评论必须存在、未删除、且属于同一个帖子。
            // 校验"同一个帖子"是为了防止用 A 帖的评论 id 往 B 帖里插回复，
            // 那样 root 关系会跨帖，列表查询就串了。
            if (parent == null
                    || parent.getStatus() != Comment.STATUS_NORMAL
                    || !parent.getPostId().equals(postId)) {
                throw new BizException(ContentErrorCode.COMMENT_NOT_FOUND);
            }
            // 两级平铺：不管嵌套多深，root 永远是那条一级评论
            rootId = parent.getRootCommentId() != null ? parent.getRootCommentId() : parent.getId();
            comment.setRootCommentId(rootId);
            comment.setReplyToCommentId(parent.getId());
            // 快照："我当时回复的是谁"。父评论作者删号后仍应显示"回复 @某人"
            comment.setReplyToUserId(parent.getAuthorId());
        }

        commentMapper.insert(comment);
        postMapper.incrementCommentCount(postId);
        if (rootId != null) {
            commentMapper.incrementReplyCount(rootId);
        }

        log.info("评论已发布 id={} postId={} rootId={} authorId={}",
                comment.getId(), postId, rootId, userId);
        return CommentView.of(comment);
    }

    /** 一级评论列表，按时间正序 */
    public CommentPage listTopLevel(Long postId, String cursor, Integer limit) {
        requirePost(postId);
        int size = normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_TOP);

        List<Comment> rows = (c == null)
                ? commentMapper.topFirstPage(postId, size + 1)
                : commentMapper.topPageAfter(postId, toTime(c), c.id(), size + 1);

        return page(rows, size, SORT_TOP);
    }

    /** 某个一级评论下的回复，按时间正序（两级平铺，不再嵌套） */
    public CommentPage listReplies(Long rootCommentId, String cursor, Integer limit) {
        Comment root = commentMapper.selectById(rootCommentId);
        if (root == null || root.getStatus() == Comment.STATUS_HIDDEN) {
            throw new BizException(ContentErrorCode.COMMENT_NOT_FOUND);
        }
        int size = normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_REPLIES);

        List<Comment> rows = (c == null)
                ? commentMapper.replyFirstPage(rootCommentId, size + 1)
                : commentMapper.replyPageAfter(rootCommentId, toTime(c), c.id(), size + 1);

        return page(rows, size, SORT_REPLIES);
    }

    /**
     * 删除评论。只有作者本人可以删。
     *
     * <b>tombstone 不是一律软删</b>：
     *   - 有回复 → 软删（保留行，否则子回复的 root_comment_id 变孤儿）
     *   - 没有回复 → 物理删（留一行"该评论已删除"的空壳毫无意义）
     *
     * 由此守住一条不变量：**status=0 的评论一定有回复**。
     * 于是列表查询完全不用过滤 status，索引也不必带它。
     *
     * 连带处理：删掉一条回复后，若它的主楼是 tombstone 且已经没有任何回复，
     * 那条主楼也该一起物理删——否则不变量被破坏，列表里会冒出空壳。
     */
    @Transactional
    public void delete(Long userId, Long commentId) {
        Comment comment = commentMapper.selectById(commentId);
        if (comment == null || comment.getStatus() == Comment.STATUS_HIDDEN) {
            throw new BizException(ContentErrorCode.COMMENT_NOT_FOUND);
        }
        if (!comment.getAuthorId().equals(userId)) {
            // 帖主也不能删别人的评论；版主权限是 P7 的新概念
            throw new BizException(CommonErrorCode.FORBIDDEN, "只能删除自己的评论");
        }
        if (comment.getStatus() == Comment.STATUS_DELETED) {
            return; // 幂等：已删除，重复删不报错
        }

        boolean hasReplies = comment.getReplyCount() != null && comment.getReplyCount() > 0;
        if (hasReplies) {
            commentMapper.softDelete(commentId);
        } else {
            commentMapper.deleteById(commentId);
        }
        postMapper.decrementCommentCount(comment.getPostId());

        Long rootId = comment.getRootCommentId();
        if (rootId != null) {
            commentMapper.decrementReplyCount(rootId);
            // 主楼是 tombstone 且最后一条回复刚被删掉 → 连主楼一起清理
            Comment root = commentMapper.selectById(rootId);
            if (root != null
                    && root.getStatus() == Comment.STATUS_DELETED
                    && (root.getReplyCount() == null || root.getReplyCount() == 0)) {
                commentMapper.deleteById(rootId);
                postMapper.decrementCommentCount(root.getPostId());
                log.info("tombstone 已无回复，一并物理删除 rootId={}", rootId);
            }
        }

        log.info("评论已删除 id={} 软删={} authorId={}", commentId, hasReplies, userId);
    }

    // ---------------------------------------------------------------- 内部

    private CommentPage page(List<Comment> rows, int size, String sort) {
        List<CommentView> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(CommentView.of(rows.get(i)));
        }
        String next = null;
        if (rows.size() > size) {
            Comment last = rows.get(size - 1);
            next = CursorCodec.encode(sort, toMillis(last.getCreatedAt()), last.getId());
        }
        return new CommentPage(items, next);
    }

    private Post requirePost(Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getStatus() != Post.STATUS_NORMAL) {
            throw new BizException(ContentErrorCode.POST_NOT_FOUND);
        }
        return post;
    }

    /**
     * 成员校验。与发帖走同一个内部接口（ADR 0008：服务间身份显式传参）。
     *
     * 不复用 PostService 的私有方法：那会把两个服务类耦在一起。
     * 这段逻辑很小，重复一份比引入耦合便宜。
     */
    private void requireMembership(Long communityId, Long userId) {
        Result<MembershipView> result;
        try {
            result = membershipClient.membership(communityId, userId);
        } catch (Exception e) {
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

    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static LocalDateTime toTime(CursorCodec.Cursor c) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()), ZoneId.systemDefault());
    }

    private static long toMillis(LocalDateTime t) {
        return t.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
