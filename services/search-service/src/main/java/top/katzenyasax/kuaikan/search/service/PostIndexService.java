package top.katzenyasax.kuaikan.search.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.mq.PostCreated;
import top.katzenyasax.kuaikan.search.es.ElasticsearchGateway;
import top.katzenyasax.kuaikan.search.es.IndexNames;
import top.katzenyasax.kuaikan.search.es.PostDocument;

/**
 * 索引的写路径：事件消费进来的增、删、改昵称。
 *
 * <h2>索引的"首次创建"发生在写入时</h2>
 *
 * 启动自检会尝试建一次（见 {@code IndexBootstrap}），但 ES 可能在那时不可用。
 * 所以每个写操作都先 {@link #ensureReady()}：别名不在就建索引 + 绑别名。
 * 用 {@code volatile} 标记 + 双重检查，正常路径上只是一次内存读。
 *
 * <b>为什么不能"没索引就直接失败"</b>：ES 比本服务晚启动是常态
 * （compose 里 search-service 也不依赖 ES），一条消费失败就会重投，
 * 但重投上限用完就进死信队列了 —— 第一次写入顺手把索引建出来，这条路径才闭合。
 *
 * <h2>幂等性来自哪里</h2>
 *
 * <ul>
 *   <li>建：{@code _id = postId} 的覆盖写，同一条事件消费两次结果相同</li>
 *   <li>删：404 视为成功（本来就不在了，目的已经达到）</li>
 *   <li>改昵称：写的是"新昵称"这个绝对值，不是增量</li>
 * </ul>
 *
 * <h2>不吞异常</h2>
 *
 * 下游（ES / user / community）失败时异常一路抛到消费者，
 * 由 RocketMQ 重投。把失败吞掉写成一条不完整的文档，比重投一百次更糟：
 * 后者会自愈，前者只能靠全量重建。
 */
@Service
public class PostIndexService {

    private static final Logger log = LoggerFactory.getLogger(PostIndexService.class);

    private final ElasticsearchGateway es;
    private final DirectoryService directory;

    /** 别名已就绪。只为省掉每条消息一次 {@code GET /_alias}；丢了也只是多查一次 */
    private volatile boolean aliasesReady;
    private volatile boolean postChunkAliasesReady;
    private volatile boolean noteChunkAliasesReady;

    public PostIndexService(ElasticsearchGateway es, DirectoryService directory) {
        this.es = es;
        this.directory = directory;
    }

    /**
     * 确保 {@code post_read} / {@code post_write} 别名存在。
     *
     * 只在两个别名<b>都</b>不存在时创建：任何一个在，就说明索引已初始化，
     * 此时再建一个空索引只会制造一个谁也不指向的孤儿。
     */
    public synchronized void ensureReady() {
        if (aliasesReady) {
            return;
        }
        if (es.aliasExists(IndexNames.READ_ALIAS) || es.aliasExists(IndexNames.WRITE_ALIAS)) {
            aliasesReady = true;
            return;
        }
        String index = es.newIndexName();
        es.createIndex(index);
        es.attachAliases(index);
        aliasesReady = true;
        log.info("ES 索引已初始化 index={} aliases={},{}",
                index, IndexNames.READ_ALIAS, IndexNames.WRITE_ALIAS);
    }

    /** 确保 {@code post_chunk_read} / {@code post_chunk_write} 存在 */
    public synchronized void ensurePostChunkReady() {
        if (postChunkAliasesReady) {
            return;
        }
        if (es.aliasExists(IndexNames.POST_CHUNK_READ) || es.aliasExists(IndexNames.POST_CHUNK_WRITE)) {
            postChunkAliasesReady = true;
            return;
        }
        String index = IndexNames.physicalPostChunkIndexNow();
        es.createPostChunkIndex(index);
        es.attachAliases(index, IndexNames.POST_CHUNK_READ, IndexNames.POST_CHUNK_WRITE);
        postChunkAliasesReady = true;
        log.info("ES 帖子切片索引已初始化 index={} aliases={},{}",
                index, IndexNames.POST_CHUNK_READ, IndexNames.POST_CHUNK_WRITE);
    }

    /** 确保 {@code note_chunk_read} / {@code note_chunk_write} 存在 */
    public synchronized void ensureNoteChunkReady() {
        if (noteChunkAliasesReady) {
            return;
        }
        if (es.aliasExists(IndexNames.NOTE_CHUNK_READ) || es.aliasExists(IndexNames.NOTE_CHUNK_WRITE)) {
            noteChunkAliasesReady = true;
            return;
        }
        String index = IndexNames.physicalNoteChunkIndexNow();
        es.createNoteChunkIndex(index);
        es.attachAliases(index, IndexNames.NOTE_CHUNK_READ, IndexNames.NOTE_CHUNK_WRITE);
        noteChunkAliasesReady = true;
        log.info("ES 笔记切片索引已初始化 index={} aliases={},{}",
                index, IndexNames.NOTE_CHUNK_READ, IndexNames.NOTE_CHUNK_WRITE);
    }

    /** 消费 {@code PostCreated}：补齐昵称与社群名后覆盖写 */
    public void indexPost(PostCreated event) {
        ensureReady();
        long authorId = parseId(event.authorId(), "authorId");
        long communityId = parseId(event.communityId(), "communityId");

        String nickname = directory.nickname(authorId);
        String communityName = directory.communityName(communityId);

        es.indexDocument(event.postId(), new PostDocument(
                event.postId(),
                event.communityId(),
                event.authorId(),
                event.title(),
                event.body(),
                nickname,
                communityName,
                event.createdAt()));
        log.debug("帖子已入索引 postId={} authorId={} communityId={}", event.postId(), authorId, communityId);
    }

    /**
     * 消费 {@code PostDeleted}：按 {@code postId} 删文档。
     *
     * <b>不调用 ensureReady</b>：删一条不存在的帖子不需要一个索引。
     * 若索引恰好还没建，ES 会回 404，而 404 本身就是"删成功"。
     */
    public void deletePost(String postId) {
        es.deleteDocument(postId);
    }

    /**
     * 消费 {@code UserProfileUpdated}：按 {@code authorId} 批量改写历史帖的昵称。
     *
     * @return 更新的文档数（0 只是说明这个作者还没有帖子进索引，不是错误）
     */
    public long updateAuthorNickname(String authorId, String nickname) {
        ensureReady();
        long updated = es.updateAuthorNickname(authorId, nickname);
        log.debug("昵称已同步到索引 authorId={} updated={}", authorId, updated);
        return updated;
    }

    private static long parseId(String raw, String field) {
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("事件载荷里的 " + field + " 不是合法雪花 id：" + raw, e);
        }
    }
}
