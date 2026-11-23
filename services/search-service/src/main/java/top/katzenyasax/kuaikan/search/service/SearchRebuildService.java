package top.katzenyasax.kuaikan.search.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.config.SearchProperties;
import top.katzenyasax.kuaikan.search.es.ElasticsearchGateway;
import top.katzenyasax.kuaikan.search.es.IndexNames;
import top.katzenyasax.kuaikan.search.es.PostDocument;
import top.katzenyasax.kuaikan.search.feign.ContentIndexClient;
import top.katzenyasax.kuaikan.search.feign.dto.InternalSearchPostItemView;
import top.katzenyasax.kuaikan.search.web.dto.RebuildResult;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 零停机全量重建（p6-search.md §4.3）。
 *
 * <pre>
 *   1. 建 post_v{ts}（带 mapping）
 *   2. 按游标分页从 content 拉 status=1 的帖子，每页 200
 *   3. 每页收集 authorId / communityId，批量补齐昵称与社群名
 *   4. _bulk 写入新索引
 *   5. _refresh
 *   6. 一次 POST /_aliases 把 post_read / post_write 原子切到新索引
 *   7. 尽力删旧物理索引（失败只记 WARN）
 * </pre>
 *
 * <h2>为什么是"新索引 + 切别名"而不是"清空重灌"</h2>
 *
 * 清空重灌期间读请求会看到空结果或半成品，且一旦中途失败索引就废了。
 * 新索引方案里，旧索引在切换那一刻之前一直是完整的，失败只需删掉新索引重来。
 *
 * <h2>为什么失败要删掉新索引</h2>
 *
 * 不删就会留下一个不挂别名的孤儿索引，占用磁盘且没人会再清理它。
 * 删除本身也可能失败（ES 挂了），所以只记 WARN —— 这属于运维可接受的小残留。
 *
 * <h2>重建期间的写入</h2>
 *
 * 别名切换是原子的，但重建开始之后、切换完成之前的写入仍然落在旧索引。
 * 旧索引随后被删除，所以那几条帖子只存在于“曾经的新索引”里，不会自动补回。
 * 这是设计上已接受的窗口（p6-search.md §4.3 只要求“零停机”，不要求零丢失），
 * 收敛手法是：低峰执行；或重建完成后再调一次（重建幂等，且每次都会重新
 * 从 content 全量拉取，因此第二次一定包含第一次窗口里的新帖）。
 * 不为此引入双写 —— 那会把 ES 的可用性重新担回发帖路径，而这正是 P6 要避免的。
 */
@Service
public class SearchRebuildService {

    private static final Logger log = LoggerFactory.getLogger(SearchRebuildService.class);

    /** 防御下游异常时死循环。10 万页 × 200 = 2000 万帖，远超实际规模 */
    private static final int MAX_PAGES = 100_000;

    private final ElasticsearchGateway es;
    private final DirectoryService directory;
    private final ContentIndexClient contentClient;
    private final SearchProperties props;

    public SearchRebuildService(ElasticsearchGateway es,
                                DirectoryService directory,
                                ContentIndexClient contentClient,
                                SearchProperties props) {
        this.es = es;
        this.directory = directory;
        this.contentClient = contentClient;
        this.props = props;
    }

    public RebuildResult rebuild() {
        long startedAt = System.currentTimeMillis();
        String index = es.newIndexName();
        log.info("全量重建开始 index={}", index);
        es.createIndex(index);

        boolean switched = false;
        try {
            long indexed = loadAll(index);
            es.refresh(index);

            Set<String> oldIndices = new LinkedHashSet<>();
            oldIndices.addAll(es.indicesOfAlias(IndexNames.READ_ALIAS));
            oldIndices.addAll(es.indicesOfAlias(IndexNames.WRITE_ALIAS));
            oldIndices.remove(index);

            es.switchAliases(index, oldIndices);
            switched = true;

            for (String old : oldIndices) {
                es.deleteIndexQuietly(old);
            }

            long elapsed = System.currentTimeMillis() - startedAt;
            log.info("全量重建完成 index={} indexed={} elapsedMs={} 旧索引={}",
                    index, indexed, elapsed, oldIndices);
            return new RebuildResult(index, indexed, elapsed);
        } catch (RuntimeException e) {
            if (!switched) {
                // 切换前失败：新索引从没对外服务过，直接清理掉，别留孤儿
                log.warn("全量重建失败，清理新索引 index={}：{}", index, e.toString());
                es.deleteIndexQuietly(index);
            }
            throw e;
        }
    }

    /** 游标遍历全量，边拉边写。返回写入文档总数 */
    private long loadAll(String index) {
        int pageSize = Math.max(1, props.getRebuildPageSize());
        long indexed = 0;
        String cursor = null;

        for (int page = 0; page < MAX_PAGES; page++) {
            Result<PageResult<InternalSearchPostItemView>> result =
                    contentClient.posts(cursor, pageSize);
            PageResult<InternalSearchPostItemView> body = result == null ? null : result.data();
            if (body == null) {
                throw new IllegalStateException("全量拉帖返回空 body cursor=" + cursor);
            }
            List<InternalSearchPostItemView> items = body.items();
            if (items == null || items.isEmpty()) {
                break;
            }

            List<PostDocument> docs = toDocuments(items);
            indexed += es.bulkIndex(index, docs);
            log.debug("重建写入一批 index={} page={} 本批={} 累计={}",
                    index, page, docs.size(), indexed);

            if (!body.hasMore() || body.nextCursor() == null || body.nextCursor().isBlank()) {
                break;
            }
            cursor = body.nextCursor();
        }
        return indexed;
    }

    /** 一页帖子的反范式补齐：两批内部查询，而不是逐条 N+1 */
    private List<PostDocument> toDocuments(List<InternalSearchPostItemView> items) {
        Set<Long> authorIds = new LinkedHashSet<>();
        Set<Long> communityIds = new LinkedHashSet<>();
        for (InternalSearchPostItemView item : items) {
            authorIds.add(item.authorId());
            communityIds.add(item.communityId());
        }

        Map<Long, String> nicknames = directory.nicknames(authorIds);
        Map<Long, String> communityNames = directory.communityNames(communityIds);

        List<PostDocument> docs = new ArrayList<>(items.size());
        for (InternalSearchPostItemView item : items) {
            docs.add(new PostDocument(
                    String.valueOf(item.postId()),
                    String.valueOf(item.communityId()),
                    String.valueOf(item.authorId()),
                    item.title(),
                    item.body(),
                    nicknames.getOrDefault(item.authorId(), DirectoryService.DELETED_NICKNAME),
                    communityNames.getOrDefault(item.communityId(), DirectoryService.MISSING_COMMUNITY),
                    item.createdAt()));
        }
        return docs;
    }
}
