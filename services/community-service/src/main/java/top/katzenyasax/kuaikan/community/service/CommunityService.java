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
import top.katzenyasax.kuaikan.community.domain.CommunityBan;
import top.katzenyasax.kuaikan.community.domain.CommunityHistory;
import top.katzenyasax.kuaikan.community.domain.CommunityMember;
import top.katzenyasax.kuaikan.community.mapper.CommunityBanMapper;
import top.katzenyasax.kuaikan.community.mapper.CommunityHistoryMapper;
import top.katzenyasax.kuaikan.community.mapper.CommunityMapper;
import top.katzenyasax.kuaikan.community.mapper.CommunityMemberMapper;
import top.katzenyasax.kuaikan.community.web.dto.CommunityDetail;
import top.katzenyasax.kuaikan.community.web.dto.CommunityPage;
import top.katzenyasax.kuaikan.community.web.dto.CommunitySummary;
import top.katzenyasax.kuaikan.community.web.dto.CreateCommunityRequest;
import top.katzenyasax.kuaikan.community.web.dto.MembershipResponse;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 社群的建、读与加入/退出。
 *
 * 没有 slug：社群名本身就是标识，name_key 是它的规范化形式（见 {@link NameKeys}）。
 * 名称创建后不可改——它成了 URL，改名等于让所有旧链接失效。
 *
 * 管理员（{@code owner_id}）的治理能力不在这里：编辑信息、转让、封禁、成员名单
 * 全部在 {@link CommunityGovernanceService}，因为那边每个方法都要先过一道
 * "调用者是不是当前管理员"的校验，混进来会让人分不清哪些是公开路径。
 * 这里只有两处与治理相交：创建社群写首条历史，加入社群查有效封禁。
 */
@Service
public class CommunityService {

    private static final Logger log = LoggerFactory.getLogger(CommunityService.class);

    /**
     * 排序标记，编进游标。**每个列表的标记必须不同**：
     * 社群列表是 community-new，帖子列表是 post-new。
     * 否则把一个列表的游标喂给另一个列表时，会被当成有效游标静默解析出错误结果。
     */
    private static final String SORT_NEW = "community-new";

    /** /mine 的排序标记：按加入时间倒序，与会话游标分开 */
    private static final String SORT_MINE = "mine";

    /**
     * 公开版「某人加入的社群」的排序标记。
     *
     * 查询结构与 /mine 完全一样，但游标标记必须另一个：
     * 否则拿 A 的 /mine 游标去查 B 的列表也能“成功”，跳出一个
     * 看起来正常实际跟前一次无关的页 —— 那是没有人能复现的 bug。
     */
    private static final String SORT_USER_JOINED = "user-joined";

    /** 封禁到期的展示格式。与响应里的其他时间字段不同：这是一句话里的时间 */
    private static final DateTimeFormatter BAN_UNTIL_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final CommunityMapper communityMapper;
    private final CommunityMemberMapper memberMapper;
    private final CommunityBanMapper banMapper;
    private final CommunityHistoryMapper historyMapper;

    public CommunityService(CommunityMapper communityMapper,
                            CommunityMemberMapper memberMapper,
                            CommunityBanMapper banMapper,
                            CommunityHistoryMapper historyMapper) {
        this.communityMapper = communityMapper;
        this.memberMapper = memberMapper;
        this.banMapper = banMapper;
        this.historyMapper = historyMapper;
    }

    /**
     * 建社群。
     *
     * 创建者同时成为**所有者**（t_community.owner_id）、**第一个成员**
     * （t_community_member 一行）与首条编年史的操作人，member_count 从 1 起。
     *
     * 这几件事必须在同一个事务里：否则会出现"社群存在但没有所有者"、
     * "所有者不是成员、无法发帖"或"社群在但历史里查不到它何时建立"的中间态。
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

        // 首条编年史，与社群同一个事务：历史是"这个社群发生过什么"的事实，
        // 不能出现「社群在、但没人记得它是什么时候由谁建的」。
        // 存量社群由 V2 迁移用同样的口径回填（detail 一字不差）
        historyMapper.insert(CommunityHistory.of(community.getId(),
                CommunityHistory.EVENT_COMMUNITY_CREATED, CommunityHistory.CATEGORY_MILESTONE,
                userId, userId, "创建了社群"));

        log.info("社群已创建 id={} name={} ownerId={}", community.getId(), name, userId);
        return CommunityDetail.of(community);
    }

    /** 社群列表，按创建时间倒序（游标分页） */
    public CommunityPage list(String cursor, Integer limit) {
        int size = Paging.normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_NEW);

        LambdaQueryWrapper<Community> q = new LambdaQueryWrapper<Community>()
                .eq(Community::getStatus, Community.STATUS_NORMAL);
        if (c != null) {
            LocalDateTime ts = Paging.fromMillis(c.timestampMillis());
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
                    Paging.toMillis(rows.get(size - 1).getCreatedAt()), rows.get(size - 1).getId())
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
        // 先用 FOR UPDATE 锁住社群行：成员变更的写路径必须先拿到这个锁，
        // 否则"插入撞唯一键（留下 S 锁）+ 更新成 X 锁"会死锁（见 CommunityMapper）
        Community community = requireByNameForUpdate(name);

        // **封禁判定必须在插入之前**：封禁会把这人的成员行置为已退出，
        // 如果先 revive 再判封禁，就得在同一个事务里回滚刚刚做的"复活"——
        // 靠抛异常回滚也能对，但读代码的人需要同时相信三件事才能确认它是对的。
        // 封禁只作用于当前社群，不影响登录与其他社群
        CommunityBan ban = banMapper.selectActive(community.getId(), userId);
        if (ban != null) {
            // 封禁是业务规则（HTTP 403 + 41006），message 里带上原因与到期，
            // 否则用户只能看到"你已被封禁"而不知道封到什么时候、找谁问
            throw new BizException(CommunityErrorCode.COMMUNITY_BANNED, banMessage(ban));
        }

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
     * P7.1 起他有两条出路：先转让（{@code POST /communities/{name}/transfer}），
     * 或者不管事了让社群停在那里。P2 时期这个缺口只能改库，现在有了转让。
     */
    @Transactional
    public CommunityDetail leave(Long userId, String name) {
        Community community = requireByNameForUpdate(name);
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

    /** 我加入的社群。按 joined_at DESC, id DESC 游标分页（见 {@link #joinedCommunities}） */
    public CommunityPage mine(Long userId, String cursor, Integer limit) {
        return joinedCommunities(userId, cursor, limit, SORT_MINE);
    }

    /**
     * 指定用户已加入的社群（用户主页「社群」Tab，游客可读）。
     *
     * 与 {@link #mine} 是同一条查询（同一组索引 idx_user_joined），
     * 区别只有两点：用户来自路径参数而不是 UserContext，且**不校验用户是否存在**——
     * 校验意味着同步调 user-service，读路径不允许（ADR 0005）。
     */
    public CommunityPage userCommunities(Long userId, String cursor, Integer limit) {
        return joinedCommunities(userId, cursor, limit, SORT_USER_JOINED);
    }

    /**
     * 我 / 他加入的社群。按加入时间倒序，游标分页。
     *
     * 顺序以成员行的 joined_at 为准（不是社群的创建时间）——"我刚加的"应该在前面。
     * 游标里存的是成员行 id，与社群列表的游标含义不同，所以两者的排序标记也不同。
     */
    private CommunityPage joinedCommunities(Long userId, String cursor, Integer limit, String sort) {
        int size = Paging.normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, sort);

        LambdaQueryWrapper<CommunityMember> q = new LambdaQueryWrapper<CommunityMember>()
                .eq(CommunityMember::getUserId, userId)
                .eq(CommunityMember::getStatus, CommunityMember.STATUS_ACTIVE);
        if (c != null) {
            LocalDateTime ts = Paging.fromMillis(c.timestampMillis());
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
            next = CursorCodec.encode(sort, Paging.toMillis(last.getJoinedAt()), last.getId());
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

    /**
     * 内部查询：这个用户是不是这个社群的成员，以及管理/封禁状态。
     *
     * 不加行锁、不开事务：纯读，而且调用方（发帖校验）需要的是"此刻大概是什么状态"，
     * 强一致到毫秒没有意义 —— 用户退出社群的瞬间正好发出一个帖子，允许它成功。
     *
     * 判断顺序：**所有者 → 封禁 → 成员行**。
     *   - 所有者一定算成员、一定不算被封禁（封禁管理员是 41008，不可能写入）：
     *     owner_id 是社群属性，不依赖成员行这个不变量，
     *     "所有者不能发帖"是荒谬的失败模式，不值得为省一次判断去赌数据一致性。
     *   - 被封禁一律 member=false：即使脏数据里还留着 status=1 的成员行，
     *     封禁也必须赢 —— 否则封禁就成了一条可以绕过的建议。
     */
    public MembershipResponse membership(Long communityId, Long userId) {
        Community community = communityMapper.selectById(communityId);
        if (community == null || Community.STATUS_NORMAL != community.getStatus()) {
            return MembershipResponse.notFound();
        }
        boolean admin = community.getOwnerId().equals(userId);
        if (admin) {
            return MembershipResponse.of(true, CommunityMember.ROLE_MEMBER, true);
        }
        CommunityBan ban = banMapper.selectActive(communityId, userId);
        if (ban != null) {
            return MembershipResponse.banned(false, ban.getReason(), ban.getExpiresAt());
        }
        CommunityMember member = memberMapper.selectOne(new LambdaQueryWrapper<CommunityMember>()
                .eq(CommunityMember::getCommunityId, communityId)
                .eq(CommunityMember::getUserId, userId)
                .eq(CommunityMember::getStatus, CommunityMember.STATUS_ACTIVE));
        if (member == null) {
            return MembershipResponse.of(false, null, false);
        }
        return MembershipResponse.of(true, member.getRole(), false);
    }

    /**
     * 加行锁的按名查找，供成员变更写路径使用。
     *
     * {@link CommunityGovernanceService} 也用它：治理写路径（封禁要移出成员并扣计数）
     * 与加入/退出是同一类临界区，必须抢同一把锁。
     */
    public Community requireByNameForUpdate(String name) {
        Community community = communityMapper.selectByNameKeyForUpdate(NameKeys.of(name));
        if (community == null) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NOT_FOUND);
        }
        return community;
    }

    private Community requireById(Long id) {
        Community community = communityMapper.selectById(id);
        if (community == null) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NOT_FOUND);
        }
        return community;
    }

    /**
     * 41006 的 message：把封禁原因与到期情况讲清楚。
     *
     * 只说"你已被封禁"的话，用户唯一能做的就是去问管理员；而管理员自己也不一定记得
     * 封到什么时候。这里拼在 message 里，前端直接原样展示（业务码仍是 41006）。
     * 时间按机器时区（Asia/Shanghai）格式化成分钟级——秒对用户没有意义。
     */
    private static String banMessage(CommunityBan ban) {
        StringBuilder message = new StringBuilder(CommunityErrorCode.COMMUNITY_BANNED.message());
        if (ban.getReason() != null && !ban.getReason().isBlank()) {
            message.append("：").append(ban.getReason());
        }
        if (ban.getExpiresAt() == null) {
            message.append("；永久封禁");
        } else {
            message.append("；解封时间 ").append(BAN_UNTIL_FORMAT.format(ban.getExpiresAt()));
        }
        return message.toString();
    }
}
