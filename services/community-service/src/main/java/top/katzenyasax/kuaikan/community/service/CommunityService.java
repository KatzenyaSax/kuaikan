package top.katzenyasax.kuaikan.community.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.CommunityErrorCode;
import top.katzenyasax.kuaikan.community.domain.Community;
import top.katzenyasax.kuaikan.community.domain.CommunityMember;
import top.katzenyasax.kuaikan.community.mapper.CommunityMapper;
import top.katzenyasax.kuaikan.community.mapper.CommunityMemberMapper;
import top.katzenyasax.kuaikan.community.web.dto.CommunityDetail;
import top.katzenyasax.kuaikan.community.web.dto.CommunityPage;
import top.katzenyasax.kuaikan.community.web.dto.CommunitySummary;
import top.katzenyasax.kuaikan.community.web.dto.CreateCommunityRequest;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 社群的建与读。
 *
 * 没有 slug：社群名本身就是标识，name_key 是它的规范化形式（见 {@link NameKeys}）。
 * 名称创建后不可改——它成了 URL，改名等于让所有旧链接失效。
 */
@Service
public class CommunityService {

    private static final Logger log = LoggerFactory.getLogger(CommunityService.class);

    /** 排序标记，编进游标。P5 若加"按活跃度"排序，各排序各自解释自己的游标 */
    private static final String SORT_NEW = "new";

    /** /mine 的排序标记：按加入时间倒序，与会话游标分开 */
    private static final String SORT_MINE = "mine";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final CommunityMapper communityMapper;
    private final CommunityMemberMapper memberMapper;

    public CommunityService(CommunityMapper communityMapper, CommunityMemberMapper memberMapper) {
        this.communityMapper = communityMapper;
        this.memberMapper = memberMapper;
    }

    /**
     * 建社群。
     *
     * 创建者同时成为**所有者**（t_community.owner_id）与**第一个成员**
     * （t_community_member 一行），member_count 从 1 起。
     *
     * 这三件事必须在同一个事务里：否则会出现"社群存在但没有所有者"
     * 或"所有者不是成员、无法发帖"的中间态。
     */
    @Transactional
    public CommunityDetail create(Long userId, CreateCommunityRequest req) {
        String name = req.name().trim();
        String nameKey = NameKeys.of(name);
        // 字符集校验放在规范化**之后**：全角输入先被 NFKC 折叠成半角再判断，
        // 否则中文输入法下的 "ＡＢＣ" 会在校验阶段就被拒，NFKC 等于没生效。
        if (!NameKeys.isValidKey(nameKey)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "社群名只能包含中文、字母、数字、空格、下划线和连字符");
        }

        // 预检查给出友好错误；并发下仍可能撞唯一键，靠下面的 catch 兜底。
        // 只靠预检查会在并发时抛 500，只靠唯一键则错误信息不够明确——两者都要。
        Long exists = communityMapper.selectCount(new LambdaQueryWrapper<Community>()
                .eq(Community::getNameKey, nameKey));
        if (exists != null && exists > 0) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NAME_TAKEN);
        }

        Community community = new Community();
        community.setName(name);
        community.setNameKey(nameKey);
        community.setDescription(req.description() == null ? null : req.description().trim());
        community.setOwnerId(userId);
        community.setMemberCount(1);
        community.setStatus(Community.STATUS_NORMAL);
        try {
            communityMapper.insert(community);
        } catch (DuplicateKeyException e) {
            // 并发建同名社群：唯一键是最终裁判
            throw new BizException(CommunityErrorCode.COMMUNITY_NAME_TAKEN);
        }

        // 创建者成为第一个成员。与"加入"走同一条代码路径，不会出现两套插入逻辑
        insertMember(community.getId(), userId);

        log.info("社群已创建 id={} name={} ownerId={}", community.getId(), name, userId);
        return CommunityDetail.of(community);
    }

    /** 社群列表，按创建时间倒序（游标分页） */
    public CommunityPage list(String cursor, Integer limit) {
        int size = normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_NEW);

        LambdaQueryWrapper<Community> q = new LambdaQueryWrapper<Community>()
                .eq(Community::getStatus, Community.STATUS_NORMAL);
        if (c != null) {
            LocalDateTime ts = LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()),
                    ZoneId.systemDefault());
            // 复合游标：单列时间戳在并发建社群时会撞同一个毫秒，导致重复或跳过
            q.and(w -> w.lt(Community::getCreatedAt, ts)
                    .or(x -> x.eq(Community::getCreatedAt, ts).lt(Community::getId, c.id())));
        }
        q.orderByDesc(Community::getCreatedAt).orderByDesc(Community::getId);

        // 多取一条用来判断有没有下一页，避免额外的 count 查询
        List<Community> rows = communityMapper.selectList(q.last("LIMIT " + (size + 1)));
        List<CommunitySummary> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(CommunitySummary.of(rows.get(i)));
        }
        String next = rows.size() > size
                ? CursorCodec.encode(SORT_NEW,
                    toMillis(rows.get(size - 1).getCreatedAt()), rows.get(size - 1).getId())
                : null;
        return new CommunityPage(items, next);
    }

    /**
     * 按名称取社群详情。名称经同一套规范化，所以 /c/FRONTEND 与 /c/frontend 等价。
     *
     * 不接收查看者身份：这是公开端点，网关的放行分支一律剥离身份，
     * 传进来也永远是 null。响应里因此没有任何按人变化的字段（见 CommunityDetail）。
     */
    public CommunityDetail getByName(String name) {
        return CommunityDetail.of(requireByName(name));
    }

    /** 供后续阶段（发帖校验、加入/退出）复用的按名查找 */
    public Community requireByName(String name) {
        String nameKey = NameKeys.of(name);
        Community community = communityMapper.selectOne(new LambdaQueryWrapper<Community>()
                .eq(Community::getNameKey, nameKey)
                .eq(Community::getStatus, Community.STATUS_NORMAL));
        if (community == null) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NOT_FOUND);
        }
        return community;
    }

    /**
     * 加入社群。**幂等**：本来就是成员也返回成功，member_count 不变。
     *
     * 成员行与 member_count 在同一个本地事务里改（architecture §7：
     * 每个计数只有一个写入者，community-service 是 member_count 的唯一写入者）。
     */
    @Transactional
    public CommunityDetail join(Long userId, String name) {
        Community community = requireByName(name);

        CommunityMember row = newMember(community.getId(), userId);
        boolean added;
        try {
            memberMapper.insert(row);
            added = true;                     // 新插入
        } catch (DuplicateKeyException e) {
            // 已有一行（可能 status=0 已退出，也可能 status=1 本来就在）
            added = memberMapper.revive(community.getId(), userId, row.getJoinedAt()) == 1;
        }
        if (added) {
            communityMapper.incrementMemberCount(community.getId());
            log.info("加入社群 id={} userId={}", community.getId(), userId);
        } else {
            log.info("已在社群，幂等返回 id={} userId={}", community.getId(), userId);
        }
        return CommunityDetail.of(requireById(community.getId()));
    }

    /**
     * 退出社群。**幂等**：本来就不在社也返回成功。
     *
     * 所有者不能退出 —— 退出后会变成"不是成员的所有者"：不能发帖、社群也没人管。
     * 转让能力在 P7，这是 P2 的已知缺口（见 p2-content.md §3.1）。
     */
    @Transactional
    public CommunityDetail leave(Long userId, String name) {
        Community community = requireByName(name);
        if (community.getOwnerId().equals(userId)) {
            throw new BizException(CommunityErrorCode.OWNER_CANNOT_LEAVE);
        }
        // 只有真的从"在社"变成"已退出"（affected=1）才扣计数，避免重复扣
        if (memberMapper.markLeft(community.getId(), userId) == 1) {
            communityMapper.decrementMemberCount(community.getId());
            log.info("退出社群 id={} userId={}", community.getId(), userId);
        }
        return CommunityDetail.of(requireById(community.getId()));
    }

    /**
     * 我加入的社群。按加入时间倒序，游标分页。
     *
     * 顺序以成员行的 joined_at 为准（不是社群的创建时间）——"我刚加的"应该在前面。
     * 游标里存的是成员行 id，与社群列表的游标含义不同，所以两者的排序标记也不同。
     */
    public CommunityPage mine(Long userId, String cursor, Integer limit) {
        int size = normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_MINE);

        LambdaQueryWrapper<CommunityMember> q = new LambdaQueryWrapper<CommunityMember>()
                .eq(CommunityMember::getUserId, userId)
                .eq(CommunityMember::getStatus, CommunityMember.STATUS_ACTIVE);
        if (c != null) {
            LocalDateTime ts = LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()),
                    ZoneId.systemDefault());
            q.and(w -> w.lt(CommunityMember::getJoinedAt, ts)
                    .or(x -> x.eq(CommunityMember::getJoinedAt, ts).lt(CommunityMember::getId, c.id())));
        }
        q.orderByDesc(CommunityMember::getJoinedAt).orderByDesc(CommunityMember::getId);

        List<CommunityMember> rows = memberMapper.selectList(q.last("LIMIT " + (size + 1)));
        List<CommunityMember> page = rows.size() > size ? rows.subList(0, size) : rows;

        List<Long> ids = page.stream().map(CommunityMember::getCommunityId).toList();
        Map<Long, Community> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            for (Community community : communityMapper.selectByIds(ids)) {
                byId.put(community.getId(), community);
            }
        }
        // selectByIds 不保证顺序，这里按成员行的顺序重排（游标一致性依赖它）
        List<CommunitySummary> items = new ArrayList<>();
        for (CommunityMember m : page) {
            Community community = byId.get(m.getCommunityId());
            if (community != null && Community.STATUS_NORMAL == community.getStatus()) {
                items.add(CommunitySummary.of(community));
            }
        }
        String next = null;
        if (rows.size() > size) {
            CommunityMember last = page.get(page.size() - 1);
            next = CursorCodec.encode(SORT_MINE, toMillis(last.getJoinedAt()), last.getId());
        }
        return new CommunityPage(items, next);
    }

    /**
     * 待插入的成员行。**id 留空**，由 BaseMapper.insert 按服务配置的
     * ID_WORKER_ID 分配 —— 自己生成会绕开那个分配，而 worker-id 冲突
     * 要等到写入时才暴露。
     */
    private CommunityMember newMember(Long communityId, Long userId) {
        CommunityMember row = new CommunityMember();
        row.setCommunityId(communityId);
        row.setUserId(userId);
        row.setRole(CommunityMember.ROLE_MEMBER);
        row.setStatus(CommunityMember.STATUS_ACTIVE);
        row.setJoinedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
        return row;
    }

    private void insertMember(Long communityId, Long userId) {
        memberMapper.insert(newMember(communityId, userId));
    }

    private Community requireById(Long id) {
        Community community = communityMapper.selectById(id);
        if (community == null) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NOT_FOUND);
        }
        return community;
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static long toMillis(LocalDateTime ts) {
        return ts.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
