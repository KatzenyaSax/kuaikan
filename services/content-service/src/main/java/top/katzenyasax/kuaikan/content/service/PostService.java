package top.katzenyasax.kuaikan.content.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.ContentErrorCode;
import top.katzenyasax.kuaikan.common.mq.PostCreated;
import top.katzenyasax.kuaikan.common.mq.PostDeleted;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.common.outbox.OutboxEvent;
import top.katzenyasax.kuaikan.common.outbox.OutboxMapper;
import top.katzenyasax.kuaikan.content.config.ContentProperties;
import top.katzenyasax.kuaikan.content.domain.Post;
import top.katzenyasax.kuaikan.content.feign.CommunityMembershipClient;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;
import top.katzenyasax.kuaikan.content.web.dto.BatchPostsRequest;
import top.katzenyasax.kuaikan.content.web.dto.CreatePostRequest;
import top.katzenyasax.kuaikan.content.web.dto.InternalSearchPostItem;
import top.katzenyasax.kuaikan.content.web.dto.PostDetail;
import top.katzenyasax.kuaikan.content.web.dto.PostPage;
import top.katzenyasax.kuaikan.content.web.dto.PostSummary;
import top.katzenyasax.kuaikan.content.web.dto.PostsByAuthorsRequest;

@Service
public class PostService {

    private static final Logger log = LoggerFactory.getLogger(PostService.class);

    /** 排序标记，编进游标。P5 若加热度排序，各排序各自解释自己的游标 */
    private static final String SORT_NEW = "post-new";

    /**
     * 单作者时间线的排序标记。**与社群时间线必须不同**：
     * 两者的 SQL 形状一样、数据源一样，但列表语义不同 ——
     * 把一个作者的游标喂给社群列表（或反过来）是调用方写错了，
     * 应该明确报 40010，而不是静默按另一套过滤条件解释出一段歪掉的数据。
     */
    private static final String SORT_AUTHOR = "author-posts";

    /** 多作者时间线（/following 全部关注）的排序标记 */
    private static final String SORT_BY_AUTHORS = "authors-posts";

    /**
     * 内部全量索引游标的排序标记。
     *
     * 与所有对外列表都不同：拿对外列表的游标喂给全量回填（或反过来）
     * 会被 CursorCodec 明确报 40010，而不是静默按另一套顺序翻出一段歪数据。
     */
    private static final String SORT_SEARCH_INDEX = "post-search-index";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    /** 内部全量回填默认页大小（P6 方案 §4.3 的 200）；上限 500 防止一次拉爆内存 */
    private static final int DEFAULT_INDEX_LIMIT = 200;
    private static final int MAX_INDEX_LIMIT = 500;

    /**
     * {@code POST /posts/batch} 的单次上限（p55-social.md §3.3）。
     *
     * 50 = 「我的收藏」一屏的翻页上限：一次请求只能补一页的帖子摘要，
     * 放大批量就会把一次收藏列表刷成一次全量帖子拉取。
     */
    private static final int MAX_BATCH_IDS = 50;

    private final PostMapper postMapper;
    private final CommunityMembershipClient membershipClient;
    private final ContentProperties contentProperties;
    private final OutboxMapper outboxMapper;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public PostService(PostMapper postMapper,
                       CommunityMembershipClient membershipClient,
                       ContentProperties contentProperties,
                       OutboxMapper outboxMapper,
                       ObjectMapper objectMapper,
                       TransactionTemplate transactionTemplate) {
        this.postMapper = postMapper;
        this.membershipClient = membershipClient;
        this.contentProperties = contentProperties;
        this.outboxMapper = outboxMapper;
        this.objectMapper = objectMapper;
        this.transactionTemplate = transactionTemplate;
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
        // 判断顺序钉在 MembershipGuard 里：41001 → 41006（被封禁）→ 41004
        MembershipGuard.requireCanWrite(membershipClient, req.communityId(), userId, "发帖", log);

        Post post = new Post();
        post.setCommunityId(req.communityId());
        // 作者只来自 UserContext，请求体里根本没有这个字段
        post.setAuthorId(userId);
        post.setTitle(req.title().trim());
        post.setBody(req.body());
        post.setStatus(Post.STATUS_NORMAL);
        postMapper.insert(post);

        // 索引刷新事件与帖子插入在**同一个本地事务**里：
        // 事务提交 = 事件一定被记住；回滚 = 事件也不会留下。
        enqueuePostCreated(post);

        log.info("帖子已发布 id={} communityId={} authorId={}",
                post.getId(), post.getCommunityId(), userId);
        return PostDetail.of(post);
    }

    /**
     * 删帖。作者可以删自己的帖子；P7 起**本社群管理员可以删本社群内的任意帖子**。
     *
     * <b>软删，且事件与删除同事务</b>：搜索索引是派生读模型，删帖必须发
     * {@code PostDeleted} —— 否则会出现「搜得到但点进去 404」的脏数据。
     *
     * <b>只有真的改了行才发事件</b>：重复删、并发双删都返回幂等成功，
     * 但 {@code UPDATE ... WHERE status = 1} 影响 0 行时不写 outbox，
     * 避免同一事实被重复广播（消费方虽然幂等，但没必要制造噪音）。
     *
     * <h2>事务边界：本方法刻意不带 {@code @Transactional}</h2>
     *
     * 非作者路径要先问 community-service「你是不是这个社群的管理员」——
     * 把一次最坏 500ms 的远程调用包在事务里，等于让数据库连接陪着等，
     * 并发一上来就把连接池耗光（与 {@code CommentService.create} 同一取舍）。
     * 所以：权限查询在**事务外**，本地软删 + {@code PostDeleted} outbox 由
     * {@link TransactionTemplate} 显式包成一个短事务（{@link #softDelete}）。
     *
     * 代价是「确认是管理员」与「改到行」之间有一个窗口（例如这期间管理员刚好被转让）。
     * 后果只是这一次删除越过了一次刚发生的权限变更，可接受；把远程调用塞进事务
     * 是更确定的伤害。
     *
     * <b>作者删自己完全不看 community</b>：{@code authorId.equals(userId)} 直接放行，
     * 零额外跨服务调用——最热的那条路径不允许变慢。
     */
    public void delete(Long userId, Long postId) {
        Post post = postMapper.selectById(postId);
        // 已删除的帖子对外一律「不存在」，不区分 404 与 403
        if (post == null) {
            throw new BizException(ContentErrorCode.POST_NOT_FOUND);
        }
        // 权限在前、状态在后：非作者对一条已删帖子也该拿到 40300，
        // 而不是因为「反正已经删了」拿到静默成功
        if (!post.getAuthorId().equals(userId)) {
            // 下游不可用 → 50300（宁可删不了，也不放不确定的人过）
            MembershipGuard.requireCommunityAdmin(membershipClient, post.getCommunityId(), userId,
                    "删帖", "只能删除自己的帖子，或由社群管理员删除", log);
        }
        // 不用 @Transactional：同类自调用不走代理，注解会静默失效（见 CommentService.create）。
        // 用 TransactionTemplate 显式开事务，事务里只有本地 SQL
        transactionTemplate.executeWithoutResult(status -> softDelete(post, userId));
    }

    /** 事务边界：只有本地 SQL —— 软删 + outbox，没有任何远程调用 */
    private void softDelete(Post post, Long userId) {
        Long postId = post.getId();
        if (post.getStatus() == null || post.getStatus() != Post.STATUS_NORMAL) {
            return; // 幂等：已经删过了，重复删不报错也不重复发事件
        }
        if (postMapper.softDelete(postId) == 0) {
            // 并发下另一个事务刚删掉：本事务没改到行，也就不该发第二个事件
            log.info("删帖未改到行（已被并发删除），跳过事件 postId={} userId={}", postId, userId);
            return;
        }

        PostDeleted event = new PostDeleted(
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                String.valueOf(postId));
        enqueue(Topics.POST_DELETED, event.eventId(), event);

        log.info("帖子已删除 id={} operatorId={}", postId, userId);
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
     * 帖子时间线。游客可读。
     *
     * P5.5 起支持 {@code communityId} 或 {@code authorId}（二选一）：
     * 前者是 P2 既有行为（游标格式与游标标记都没变，零破坏），
     * 后者是用户主页「ta 发的帖子」与 /following 单人筛选。
     *
     * P2 只实现 {@code sort=new}，其他值**明确拒绝**（40010）而不是静默降级：
     * 静默降级会把 bug 藏起来，P5 上线热度排序时无法证明它真的生效了。
     *
     * 翻页的正确性靠游标的复合键：单列时间戳在"翻页过程中有人发帖"时
     * 会重复或跳过。verify-p2.sh 的 L2 有一条专门造这个场景的断言。
     */
    public PostPage list(Long communityId, Long authorId, String sort, String cursor, Integer limit) {
        // 二选一，且必须选一个。两者都空 = 没说要查谁的帖子；两者都传 = 调用方
        // 以为能做交集（本接口不支持）。两种都是调用方写错，统一 40010，不静默挑一个。
        if (communityId == null && authorId == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "必须指定 communityId 或 authorId");
        }
        if (communityId != null && authorId != null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "communityId 与 authorId 只能二选一");
        }

        String effectiveSort = (sort == null || sort.isBlank()) ? "new" : sort;
        if (!"new".equals(effectiveSort)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "暂不支持该排序方式");
        }
        int size = normalizeLimit(limit);
        return (authorId != null)
                ? authorPage(authorId, cursor, size)
                : communityPage(communityId, cursor, size);
    }

    /**
     * 某个作者的帖子（游客可读；用户主页「ta 发的帖子」与 /following 单人筛选）。
     *
     * 与社群时间线共用「多取一条判下一页」的写法，只换了过滤条件与游标标记；
     * 响应仍是同一份 {@link PostPage}，前端不需要第二套映射。
     */
    private PostPage authorPage(Long authorId, String cursor, int size) {
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_AUTHOR);
        List<Post> rows = (c == null)
                ? postMapper.firstPageByAuthor(authorId, size + 1)
                : postMapper.pageAfterByAuthor(authorId, toLocalDateTime(c), c.id(), size + 1);
        return toPage(rows, size, SORT_AUTHOR);
    }

    /** 社群时间线的分页部分（P2 既有行为：游标标记与 SQL 均未改动） */
    private PostPage communityPage(Long communityId, String cursor, int size) {
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_NEW);
        // 多取一条用来判断有没有下一页，省掉一次 count 查询
        List<Post> rows = (c == null)
                ? postMapper.firstPage(communityId, size + 1)
                : postMapper.pageAfter(communityId, toLocalDateTime(c), c.id(), size + 1);
        return toPage(rows, size, SORT_NEW);
    }

    /**
     * 一批作者的帖子（{@code /following} 的「全部关注」）。**需要登录**，由控制层把关。
     *
     * 空列表直接返回空页：前端在「还没关注任何人」时不该被迫先判断一次，
     * 也不该因为发了一个空 IN 而拿到 500。
     */
    public PostPage listByAuthors(PostsByAuthorsRequest req) {
        List<Long> authorIds = parseIds(req.authorIds(), contentProperties.getMaxAuthorIds(), "作者");
        if (authorIds.isEmpty()) {
            return new PostPage(List.of(), null);
        }
        int size = normalizeLimit(req.limit());
        CursorCodec.Cursor c = CursorCodec.decode(req.cursor(), SORT_BY_AUTHORS);
        List<Post> rows = (c == null)
                ? postMapper.firstPageByAuthors(authorIds, size + 1)
                : postMapper.pageAfterByAuthors(authorIds, toLocalDateTime(c), c.id(), size + 1);
        return toPage(rows, size, SORT_BY_AUTHORS);
    }

    /**
     * 批量查帖子摘要（{@code POST /posts/batch}，「我的收藏」用）。**需要登录**，由控制层把关。
     *
     * <b>只返回存在且未删除（{@code status = 1}）的</b>：前端把返回结果做成
     * {@code Map<postId, PostSummary>}，缺席的 postId 就判定为「该帖子已被删除」，
     * 渲染灰色占位并提供取消收藏入口（p55-social.md §3.3）。
     *
     * 空 / null 列表直接返回空列表：收藏列表为空时前端不必先判一下再发请求。
     */
    public List<PostSummary> batch(BatchPostsRequest req) {
        List<Long> ids = parseIds(req.ids(), MAX_BATCH_IDS, "帖子");
        if (ids.isEmpty()) {
            return List.of();
        }
        return postMapper.selectByIdsNormal(ids).stream().map(PostSummary::of).toList();
    }

    /**
     * 字符串雪花 id → 正 Long，去重保序，超过上限报 40010。
     *
     * 非法数字、非正整数一律 40010：静默丢弃非法项会让前端误以为
     * 「这些帖子/作者本来就不存在」，那是最难查的一类 bug（列表看起来只是少了点东西）。
     * null / 空列表返回空集，交给调用方返回空结果。
     */
    private List<Long> parseIds(List<String> raw, int max, String label) {
        Set<Long> unique = new LinkedHashSet<>();
        if (raw == null) {
            return List.of();
        }
        for (String part : raw) {
            if (part == null || part.isBlank()) {
                continue;
            }
            long id;
            try {
                id = Long.parseLong(part.trim());
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, label + " id 里含非法值");
            }
            if (id <= 0) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, label + " id 里含非法值");
            }
            unique.add(id);
            if (unique.size() > max) {
                throw new BizException(CommonErrorCode.PARAM_INVALID,
                        "单次最多查询 " + max + " 个" + label);
            }
        }
        return new ArrayList<>(unique);
    }

    /**
     * 全量拉帖（P6.1 内部接口）。给 search-service 重建索引用。
     *
     * <b>按 id 升序的游标分页</b>：id 单调且不变，一次全量遍历不重不漏。
     * 游标不透明（Base64 编码，前端/调用方不许解析）；排序标记独立，
     * 拿错列表的游标会被明确拒绝。
     *
     * {@code limit} 默认 200、上限 500：回填是服务对服务的批量读，
     * 单批太小会把一次全量变成上百次往返，太大则单次响应可达数十 MB。
     */
    public PageResult<InternalSearchPostItem> indexPage(String cursor, Integer limit) {
        int size = normalizeIndexLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_SEARCH_INDEX);
        List<Post> rows = postMapper.indexPage(c == null ? null : c.id(), size + 1);

        List<InternalSearchPostItem> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(InternalSearchPostItem.of(rows.get(i)));
        }
        String next = null;
        if (rows.size() > size) {
            Post last = rows.get(size - 1);
            next = CursorCodec.encode(SORT_SEARCH_INDEX, toMillis(last), last.getId());
        }
        return PageResult.of(items, next);
    }

    /** 把「多取的那一条」剥掉，并按同一套排序标记编下一页游标 */
    private static PostPage toPage(List<Post> rows, int size, String sort) {
        List<PostSummary> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(PostSummary.of(rows.get(i)));
        }
        String next = null;
        if (rows.size() > size) {
            Post last = rows.get(size - 1);
            next = CursorCodec.encode(sort, toMillis(last), last.getId());
        }
        return new PostPage(items, next);
    }

    private static LocalDateTime toLocalDateTime(CursorCodec.Cursor c) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()), ZoneId.systemDefault());
    }

    private static long toMillis(Post post) {
        return post.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static int normalizeIndexLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_INDEX_LIMIT;
        }
        return Math.min(limit, MAX_INDEX_LIMIT);
    }

    /**
     * 发帖事件。快照进载荷（含完整正文），消费方不回查 content。
     * 序列化失败直接抛，让整个发帖事务回滚 —— 宁可发帖失败，也不要「帖子在但索引永远不知道」。
     */
    private void enqueuePostCreated(Post post) {
        PostCreated event = new PostCreated(
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                String.valueOf(post.getId()),
                String.valueOf(post.getCommunityId()),
                String.valueOf(post.getAuthorId()),
                post.getTitle(),
                post.getBody(),
                toMillis(post));
        enqueue(Topics.POST_CREATED, event.eventId(), event);
    }

    /** 写一条 outbox 行。调用方保证它在业务事务内 */
    private void enqueue(String topic, String eventId, Object event) {
        OutboxEvent row = new OutboxEvent();
        row.setEventId(eventId);
        row.setTopic(topic);
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
}
