package top.katzenyasax.kuaikan.content.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.CommunityErrorCode;
import top.katzenyasax.kuaikan.common.error.ContentErrorCode;
import top.katzenyasax.kuaikan.common.mq.CommentCreated;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.common.outbox.OutboxEvent;
import top.katzenyasax.kuaikan.common.outbox.OutboxMapper;
import top.katzenyasax.kuaikan.content.domain.Comment;
import top.katzenyasax.kuaikan.content.domain.Post;
import top.katzenyasax.kuaikan.content.feign.CommunityMembershipClient;
import top.katzenyasax.kuaikan.content.feign.MembershipView;
import top.katzenyasax.kuaikan.content.mapper.CommentMapper;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;
import top.katzenyasax.kuaikan.content.web.dto.CommentPage;
import top.katzenyasax.kuaikan.content.web.dto.CommentView;
import top.katzenyasax.kuaikan.content.web.dto.MentionView;
import top.katzenyasax.kuaikan.content.web.dto.CreateCommentRequest;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

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
    /** 热度序一级评论。**必须与时间序用不同的标记**：跨排序复用游标会被明确拒绝 */
    private static final String SORT_TOP_HOT = "comment-top-hot";
    private static final String SORT_REPLIES = "comment-replies";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final CommentMapper commentMapper;
    private final PostMapper postMapper;
    private final CommunityMembershipClient membershipClient;
    private final OutboxMapper outboxMapper;
    private final ObjectMapper objectMapper;
    private final MentionResolver mentionResolver;
    private final TransactionTemplate transactionTemplate;

    public CommentService(CommentMapper commentMapper,
                          PostMapper postMapper,
                          CommunityMembershipClient membershipClient,
                          OutboxMapper outboxMapper,
                          ObjectMapper objectMapper,
                          MentionResolver mentionResolver,
                          TransactionTemplate transactionTemplate) {
        this.commentMapper = commentMapper;
        this.postMapper = postMapper;
        this.membershipClient = membershipClient;
        this.outboxMapper = outboxMapper;
        this.objectMapper = objectMapper;
        this.mentionResolver = mentionResolver;
        this.transactionTemplate = transactionTemplate;
    }

    /**
     * 发评论 / 回复。
     *
     * 必须走一遍成员校验：与发帖同一套权限语义。否则"能评论但不能发帖"很怪，
     * 而且给刷评论留了口子。代价是一次跨服务调用，失败一律 50300。
     */
    /**
     * 发评论 / 回复。
     *
     * <b>这个方法刻意不带 {@code @Transactional}</b>：它要先做两次跨服务调用
     * （成员校验、@ 解析），把远程调用包在事务里会让数据库连接被持有几百毫秒到几秒，
     * 并发一上来就把连接池耗光。真正的写入在 {@link #persist} 里，事务只包住本地 SQL。
     *
     * 代价是"校验通过"和"写入成功"之间有一个窗口（比如这期间帖子被删）。
     * 那个窗口的后果只是这条评论落在一个刚被删的帖子上——可接受，
     * 相比之下把远程调用塞进事务是更确定的伤害。
     */
    public CommentView create(Long userId, Long postId, CreateCommentRequest req) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getStatus() != Post.STATUS_NORMAL) {
            throw new BizException(ContentErrorCode.POST_NOT_FOUND);
        }
        requireMembership(post.getCommunityId(), userId);

        String body = req.body().trim();
        // 尽力而为：解析失败只会让 @ 不是蓝色链接，评论照发
        List<MentionView> mentions = mentionResolver.resolve(body, post.getCommunityId());

        // 用 TransactionTemplate 显式开事务，而不是把 @Transactional 放到本类的另一个方法上：
        // 同类自调用不走代理，@Transactional 会**静默失效**，事务根本没开。
        // 这类 bug 平时看不出来，出问题时才发现写入没有原子性。
        return transactionTemplate.execute(status -> persist(post, userId, body, req, mentions));
    }

    /** 事务边界只包含本地 SQL —— 不留任何远程调用 */
    private CommentView persist(Post post, Long userId, String body,
                                CreateCommentRequest req, List<MentionView> mentions) {
        Long postId = post.getId();
        Comment comment = new Comment();
        comment.setPostId(postId);
        comment.setAuthorId(userId);
        comment.setBody(body);
        comment.setLikeCount(0);
        comment.setReplyCount(0);
        comment.setStatus(Comment.STATUS_NORMAL);
        comment.setMentions(mentionResolver.toJson(mentions));

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
        // 评论也是一次互动。同事务更新：热度的衰减基准不能落后于事实。
        postMapper.touchLastInteraction(postId,
                LocalDateTime.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS));
        if (rootId != null) {
            commentMapper.incrementReplyCount(rootId);
        }

        // 与上面的写入在**同一个本地事务**里。事务提交 = 事件一定被记住，
        // 投递由 OutboxRelay 轮询负责，失败可重试。
        // 若这里抛异常，整个事务回滚 —— 宁可不发消息，也不留下"评论在但事件丢"的状态。
        enqueueCommentCreated(post, comment);

        log.info("评论已发布 id={} postId={} rootId={} authorId={}",
                comment.getId(), postId, rootId, userId);
        return CommentView.of(comment, mentions);
    }

    /**
     * 一级评论列表。
     *
     * <b>默认时间正序</b>（老的在上）——评论读起来像对话，倒序会让人从结尾往回读。
     * {@code sort=hot} 时按 {@code like_count + reply_count} 降序，并列按时间正序。
     *
     * <b>默认值保持 time 是刻意的</b>：P3 的验收断言全部依赖时间序，
     * 而且"我刚发的评论应该看得见"是用户的直觉。热度序是可选视图，不是替换。
     *
     * 未知 sort 值**明确拒绝**（40010）而不是静默降级成 time——
     * 静默降级会把前端的 bug 藏起来，也会让人以为"热度排序生效了"。
     */
    public CommentPage listTopLevel(Long postId, String sort, String cursor, Integer limit) {
        requirePost(postId);
        int size = normalizeLimit(limit);
        String effective = (sort == null || sort.isBlank()) ? "time" : sort.trim().toLowerCase();

        if ("hot".equals(effective)) {
            return listTopLevelHot(postId, cursor, size);
        }
        if (!"time".equals(effective)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "sort 只能是 time 或 hot");
        }

        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_TOP);
        List<Comment> rows = (c == null)
                ? commentMapper.topFirstPage(postId, size + 1)
                : commentMapper.topPageAfter(postId, toTime(c), c.id(), size + 1);
        return page(rows, size, SORT_TOP);
    }

    /**
     * 热度序。
     *
     * <b>已知性质：翻页是"尽力而为"的，不像时间序那样稳定。</b>
     * 排序键 {@code like_count + reply_count} 是会被别人改的——
     * 翻页期间某条评论被点赞，它可能在第二页重复出现或被跳过。
     *
     * 时间序没有这个问题（created_at 永不改变）。要彻底解决热度序的稳定性，
     * 得在翻页开始时冻结整份分数快照，那需要额外存储——不划算。
     * 前端的表现是可接受的：翻一次页最多多看/少看一条。
     */
    private CommentPage listTopLevelHot(Long postId, String cursor, int size) {
        CursorCodec.ScoredCursor c = CursorCodec.decodeScored(cursor, SORT_TOP_HOT);

        List<Comment> rows = (c == null)
                ? commentMapper.topFirstPageHot(postId, size + 1)
                : commentMapper.topPageAfterHot(postId, c.score(), toTime(c.timestampMillis(), c.id()),
                        c.id(), size + 1);

        return pageScored(rows, size);
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

    /**
     * 分数序的收口。游标要带上 score 才能唯一定位——
     * 只带 (created_at, id) 的话，同分数的两条评论之间翻页就会错。
     */
    private CommentPage pageScored(List<Comment> rows, int size) {
        List<CommentView> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            Comment row = rows.get(i);
            items.add(CommentView.of(row, mentionResolver.fromJson(row.getMentions())));
        }
        String next = null;
        if (rows.size() > size) {
            Comment last = rows.get(size - 1);
            next = CursorCodec.encodeScored(SORT_TOP_HOT, hotScore(last),
                    toMillis(last.getCreatedAt()), last.getId());
        }
        return new CommentPage(items, next);
    }

    /** 评论热度。与 Mapper 里的排序表达式必须一致，改一处就要改另一处 */
    private static long hotScore(Comment c) {
        long like = c.getLikeCount() == null ? 0 : c.getLikeCount();
        long reply = c.getReplyCount() == null ? 0 : c.getReplyCount();
        return like + reply;
    }

    private static LocalDateTime toTime(long millis, long ignoredId) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), ZoneId.systemDefault());
    }

    private CommentPage page(List<Comment> rows, int size, String sort) {
        List<CommentView> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            Comment row = rows.get(i);
            items.add(CommentView.of(row, mentionResolver.fromJson(row.getMentions())));
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

    /**
     * 写一条 {@code CommentCreated} 到 outbox。
     *
     * <b>接收人由消费者算，这里只报事实</b>：谁该收到消息（帖子作者 / 被回复者 / 被 @ 的人）
     * 是产品规则，属于 notification 的判断；content 只负责如实描述"发生了什么"。
     * 唯一例外是 {@code postAuthorId} 与 {@code replyToUserId}——它们本来就是评论的属性。
     */
    private void enqueueCommentCreated(Post post, Comment comment) {
        // 直接用写入时解析好的结果，不在这里重新解析——同一份事实只算一次
        List<String> mentionUserIds = mentionResolver.fromJson(comment.getMentions())
                .stream().map(MentionView::userId).toList();

        CommentCreated event = new CommentCreated(
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                String.valueOf(comment.getAuthorId()),
                String.valueOf(comment.getId()),
                String.valueOf(comment.getPostId()),
                String.valueOf(post.getCommunityId()),
                String.valueOf(post.getAuthorId()),
                comment.getReplyToUserId() == null ? null : String.valueOf(comment.getReplyToUserId()),
                comment.getRootCommentId() == null ? null : String.valueOf(comment.getRootCommentId()),
                mentionUserIds,
                excerpt(comment.getBody()));

        OutboxEvent row = new OutboxEvent();
        row.setEventId(event.eventId());
        row.setTopic(Topics.COMMENT_CREATED);
        try {
            row.setPayload(objectMapper.writeValueAsString(event));
        } catch (Exception e) {
            // 序列化失败说明契约本身有问题，不能静默吞掉：整个事务回滚
            throw new IllegalStateException("事件序列化失败", e);
        }
        row.setStatus(OutboxEvent.STATUS_PENDING);
        row.setRetryCount(0);
        row.setNextRetryAt(LocalDateTime.now());
        outboxMapper.insert(row);
    }

    /** 消息快照只要一小段，不需要整篇正文 */
    private static String excerpt(String body) {
        if (body == null) {
            return null;
        }
        String flat = body.strip();
        return flat.length() <= 120 ? flat : flat.substring(0, 120) + "…";
    }
}
