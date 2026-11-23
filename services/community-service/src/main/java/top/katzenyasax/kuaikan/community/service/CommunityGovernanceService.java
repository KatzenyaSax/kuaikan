package top.katzenyasax.kuaikan.community.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.PageResult;
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
import top.katzenyasax.kuaikan.community.web.dto.AdminHistoryView;
import top.katzenyasax.kuaikan.community.web.dto.AdminTermView;
import top.katzenyasax.kuaikan.community.web.dto.BanCommunityMemberRequest;
import top.katzenyasax.kuaikan.community.web.dto.CommunityBanView;
import top.katzenyasax.kuaikan.community.web.dto.CommunityDetail;
import top.katzenyasax.kuaikan.community.web.dto.CommunityHistoryView;
import top.katzenyasax.kuaikan.community.web.dto.CommunityMemberView;
import top.katzenyasax.kuaikan.community.web.dto.MyCommunityStatus;
import top.katzenyasax.kuaikan.community.web.dto.UpdateCommunityInfoRequest;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * 社群治理：管理员编辑信息、转让、成员/封禁名单、封禁解封、编年史。
 *
 * 与 {@link CommunityService} 的分界不是"表"，而是**权限**：
 * 这里每个写方法的第一件事都是确认调用者是当前管理员（{@code t_community.owner_id}），
 * 而 CommunityService 的建/读/加入/退出对所有登录用户开放。
 * 把两者混在一个类里，最危险的结果是某天给一个管理端点少写了 admin 校验，
 * 而它周围全是公开方法，没人看得出来少了什么。
 *
 * 三条贯穿全类的规则：
 *
 * 1. **管理员的唯一事实来源是 {@code t_community.owner_id}**，不是成员行的 role。
 *    P7 是单管理员制（p7-community-admin.md §1.1），role 列没有写入者。
 * 2. **写成员关系的路径先锁社群行**（{@code requireAdminForUpdate}）。
 *    封禁要"移出成员 + 成员数 -1"，与加入/退出是同一类临界区，
 *    锁顺序必须与 CommunityService 一致，否则会成环死锁（见 CommunityMapper 注释）。
 * 3. **每个写操作的副作用（改表 + 写历史）在同一个本地事务里**。
 *    历史是给人看的事实，不能出现"管理员确实改了，但编年史里没有"。
 */
@Service
public class CommunityGovernanceService {

    private static final Logger log = LoggerFactory.getLogger(CommunityGovernanceService.class);

    /**
     * 游标排序标记。**每个列表一个**，且必须与查询的排序列绑定：
     * 拿成员列表的游标去查封禁名单，会被 CursorCodec 明确拒绝（40010），
     * 而不是按错误的键跳出一段看起来正常的乱序数据。
     */
    private static final String SORT_MEMBERS = "community-members";
    private static final String SORT_BANS = "community-bans";

    /**
     * 时间线的排序标记**按分类分开**（`community-history-all` / `-milestone` /
     * `-moderation`）：三个分类的查询条件不同，同一个游标在跨分类复用时
     * 必须报 40010 —— 否则「全部」里翻到第 3 页的游标被拿去查「治理记录」，
     * 会直接跳过中间所有大事记，而结果看起来完全正常。
     */
    private static final String SORT_HISTORY_PREFIX = "community-history-";

    private static final String QUERY_CATEGORY_ALL = "all";
    private static final String QUERY_CATEGORY_MILESTONE = "milestone";
    private static final String QUERY_CATEGORY_MODERATION = "moderation";

    /** 封禁时长白名单（天）。null 另有含义：永久封禁 */
    private static final Set<Integer> ALLOWED_BAN_DAYS = Set.of(1, 7, 30);

    private static final int MAX_REASON_LENGTH = 200;

    private final CommunityService communityService;
    private final CommunityMapper communityMapper;
    private final CommunityMemberMapper memberMapper;
    private final CommunityBanMapper banMapper;
    private final CommunityHistoryMapper historyMapper;

    public CommunityGovernanceService(CommunityService communityService,
                                      CommunityMapper communityMapper,
                                      CommunityMemberMapper memberMapper,
                                      CommunityBanMapper banMapper,
                                      CommunityHistoryMapper historyMapper) {
        this.communityService = communityService;
        this.communityMapper = communityMapper;
        this.memberMapper = memberMapper;
        this.banMapper = banMapper;
        this.historyMapper = historyMapper;
    }

    // --------------------------------------------------------------- 我的状态

    /**
     * 我在这个社群里的状态。**需要登录**，不进网关白名单。
     *
     * 一次回答三个按钮问题（加入 / 管理 / 被封禁），前端因此不必同时拉
     * /mine（分页，可能不含这一条）与封禁名单（管理员才有权限）。
     *
     * 被封禁时 {@code joined=false}：封禁已经把在社的成员行置为已退出，
     * 即使数据里还留着 status=1 的行，也不该告诉前端"他在社"。
     */
    public MyCommunityStatus myStatus(Long userId, String name) {
        Community community = communityService.requireByName(name);
        boolean admin = community.getOwnerId().equals(userId);
        // 管理员不可能被封禁（封禁自己是 41008），所以对管理员**不查封禁**：
        // 省一次查询，更重要的是让这里与内部 membership 的判断结果一致——
        // 两处对"我是不是被封了"给出不同答案，前端就会把加入按钮禁用而
        // 后端却允许发帖
        CommunityBan ban = admin ? null : banMapper.selectActive(community.getId(), userId);
        boolean banned = ban != null;
        boolean joined = !banned && (admin || isActiveMember(community.getId(), userId));
        return new MyCommunityStatus(joined, admin, banned,
                banned ? ban.getReason() : null,
                banned ? ban.getExpiresAt() : null);
    }

    // --------------------------------------------------------------- 编辑信息

    /**
     * 编辑简介 / 头像 / 公告。**只有实际变化才写历史**：
     * 「保存」按两次就多两条 INFO_UPDATED，时间线会变成一堆"更新了社群"，
     * 真正的大事反而被淹没。
     *
     * 加 FOR UPDATE 锁社群行：两个管理员（转让前后）同时编辑时，
     * 历史里的"修改了哪些字段"必须对应真正落库的那一份差异。
     */
    @Transactional
    public CommunityDetail updateInfo(Long operatorId, String name, UpdateCommunityInfoRequest req) {
        Community community = requireAdminForUpdate(operatorId, name);

        // null = 不修改，空串 = 清空（见 UpdateCommunityInfoRequest 的注释）
        String description = normalizeText(req.description(), community.getDescription());
        String avatarUrl = normalizeText(req.avatarUrl(), community.getAvatarUrl());
        String announcement = normalizeText(req.announcement(), community.getAnnouncement());
        requireSafeAvatarUrl(avatarUrl);

        List<String> changed = new ArrayList<>(3);
        if (!Objects.equals(description, community.getDescription())) {
            changed.add("简介");
        }
        if (!Objects.equals(avatarUrl, community.getAvatarUrl())) {
            changed.add("头像");
        }
        if (!Objects.equals(announcement, community.getAnnouncement())) {
            changed.add("公告");
        }
        if (changed.isEmpty()) {
            return CommunityDetail.of(community);
        }

        communityMapper.updateInfo(community.getId(), description, avatarUrl, announcement);
        historyMapper.insert(CommunityHistory.of(community.getId(),
                CommunityHistory.EVENT_INFO_UPDATED, CommunityHistory.CATEGORY_MILESTONE,
                operatorId, null, "更新了社群" + String.join("、", changed)));

        // 响应要返回更新后的详情：库里已改，内存对象也必须改，否则前端拿到的
        // 是"保存成功但内容还是旧的"
        community.setDescription(description);
        community.setAvatarUrl(avatarUrl);
        community.setAnnouncement(announcement);
        log.info("社群信息已更新 id={} operatorId={} fields={}", community.getId(), operatorId, changed);
        return CommunityDetail.of(community);
    }

    // --------------------------------------------------------------- 转让

    /**
     * 转让管理员。
     *
     * 目标必须是**本社群在社且未被有效封禁**的成员，否则 41009——
     * 把管理员交给一个已经退群或正在被封禁的人，等于让社群无人可管。
     *
     * 原管理员降为普通成员（他那行成员记录本来就在，role 也不改），
     * 于是 P2 的 41005「创建者不能退出」自动失效——他不再是 owner。
     */
    @Transactional
    public CommunityDetail transfer(Long operatorId, String name, Long targetUserId) {
        Community community = requireAdminForUpdate(operatorId, name);
        if (targetUserId == null || targetUserId.equals(operatorId)) {
            throw new BizException(CommunityErrorCode.TRANSFER_TARGET_INVALID);
        }
        if (!isActiveMember(community.getId(), targetUserId)) {
            throw new BizException(CommunityErrorCode.TRANSFER_TARGET_INVALID, "只能转让给本社群的在社成员");
        }
        if (banMapper.selectActive(community.getId(), targetUserId) != null) {
            throw new BizException(CommunityErrorCode.TRANSFER_TARGET_INVALID, "该用户正在本社群封禁中");
        }

        communityMapper.updateOwner(community.getId(), targetUserId);
        historyMapper.insert(CommunityHistory.of(community.getId(),
                CommunityHistory.EVENT_ADMIN_TRANSFERRED, CommunityHistory.CATEGORY_MILESTONE,
                operatorId, targetUserId, "将社群管理员转让"));

        community.setOwnerId(targetUserId);
        log.info("社群管理员已转让 id={} from={} to={}", community.getId(), operatorId, targetUserId);
        return CommunityDetail.of(community);
    }

    // --------------------------------------------------------------- 成员名单

    /**
     * 在社成员，按 joined_at DESC, id DESC 游标分页。
     *
     * 成员行与社群行都可能为空/不一致，但这里**不补 owner**：
     * 所有者不能退出（41005），他那行一定在，补一条反而会掩盖数据问题。
     */
    public PageResult<CommunityMemberView> members(Long operatorId, String name,
                                                   String cursor, Integer limit) {
        Community community = requireAdmin(operatorId, name);
        int size = Paging.normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_MEMBERS);

        LambdaQueryWrapper<CommunityMember> q = new LambdaQueryWrapper<CommunityMember>()
                .eq(CommunityMember::getCommunityId, community.getId())
                .eq(CommunityMember::getStatus, CommunityMember.STATUS_ACTIVE);
        if (c != null) {
            LocalDateTime ts = Paging.fromMillis(c.timestampMillis());
            q.and(w -> w.lt(CommunityMember::getJoinedAt, ts)
                    .or(x -> x.eq(CommunityMember::getJoinedAt, ts).lt(CommunityMember::getId, c.id())));
        }
        q.orderByDesc(CommunityMember::getJoinedAt).orderByDesc(CommunityMember::getId);

        // 多取一条判 hasMore，省掉一次没人会看的 count
        List<CommunityMember> rows = memberMapper.selectList(q.last("LIMIT " + (size + 1)));
        boolean hasMore = rows.size() > size;
        List<CommunityMember> page = hasMore ? rows.subList(0, size) : rows;

        List<CommunityMemberView> items = new ArrayList<>(page.size());
        for (CommunityMember row : page) {
            items.add(new CommunityMemberView(row.getUserId(), row.getJoinedAt(),
                    community.getOwnerId().equals(row.getUserId())));
        }
        String next = null;
        if (hasMore) {
            CommunityMember last = page.get(page.size() - 1);
            next = CursorCodec.encode(SORT_MEMBERS, Paging.toMillis(last.getJoinedAt()), last.getId());
        }
        return PageResult.of(items, next);
    }

    // --------------------------------------------------------------- 封禁名单

    /** 生效中的封禁，按 banned_at DESC, id DESC 游标分页。已解封/已过期的不出现 */
    public PageResult<CommunityBanView> bans(Long operatorId, String name,
                                             String cursor, Integer limit) {
        Community community = requireAdmin(operatorId, name);
        int size = Paging.normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_BANS);

        LocalDateTime beforeAt = null;
        Long beforeId = null;
        if (c != null) {
            beforeAt = Paging.fromMillis(c.timestampMillis());
            beforeId = c.id();
        }
        // 「有效封禁」的条件（status=1 且未过期）写在 SQL 里，与
        // CommunityBanMapper.selectActive / liftActive 是同一个判定
        List<CommunityBan> rows = beforeAt == null
                ? banMapper.selectActiveFirstPage(community.getId(), size + 1)
                : banMapper.selectActivePageAfter(community.getId(), beforeAt, beforeId, size + 1);
        boolean hasMore = rows.size() > size;
        List<CommunityBan> page = hasMore ? rows.subList(0, size) : rows;

        List<CommunityBanView> items = new ArrayList<>(page.size());
        for (CommunityBan row : page) {
            items.add(new CommunityBanView(row.getUserId(), row.getBannedBy(), row.getReason(),
                    row.getBannedAt(), row.getExpiresAt()));
        }
        String next = null;
        if (hasMore) {
            CommunityBan last = page.get(page.size() - 1);
            next = CursorCodec.encode(SORT_BANS, Paging.toMillis(last.getBannedAt()), last.getId());
        }
        return PageResult.of(items, next);
    }

    // --------------------------------------------------------------- 封禁 / 解封

    /**
     * 封禁用户（可永久）。允许封禁**已退群**的人：发完违规帖再退群不能成为逃避方式。
     *
     * 对象在社时同步移出并 member_count - 1，与「退出社群」是同一条路径
     * （markLeft 返回 1 才扣减），因此重复封禁不会把计数扣成负数。
     *
     * 封禁自己 → 41008（业务规则，HTTP 200）。管理员是唯一能把社群救回来的人，
     * 把自己封掉等于让社群失去治理能力，且没有任何自助解封入口。
     */
    @Transactional
    public CommunityBanView ban(Long operatorId, String name, BanCommunityMemberRequest req) {
        Community community = requireAdminForUpdate(operatorId, name);
        Long targetUserId = req.userId();
        if (community.getOwnerId().equals(targetUserId)) {
            throw new BizException(CommunityErrorCode.CANNOT_BAN_ADMIN);
        }

        Integer durationDays = req.durationDays();
        if (durationDays != null && !ALLOWED_BAN_DAYS.contains(durationDays)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "封禁时长只能是 1 天、7 天、30 天或永久");
        }
        String reason = normalizeReason(req.reason());

        LocalDateTime now = LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS);
        LocalDateTime expiresAt = durationDays == null ? null : now.plusDays(durationDays);

        // 在社就踢出去。markLeft 返回 1 才是"真的从在社变成已退出"，才扣计数
        if (memberMapper.markLeft(community.getId(), targetUserId) == 1) {
            communityMapper.decrementMemberCount(community.getId());
        }

        CommunityBan row = new CommunityBan();
        row.setCommunityId(community.getId());
        row.setUserId(targetUserId);
        row.setBannedBy(operatorId);
        row.setReason(reason);
        row.setExpiresAt(expiresAt);
        row.setStatus(CommunityBan.STATUS_ACTIVE);
        row.setBannedAt(now);
        try {
            banMapper.insert(row);
        } catch (DuplicateKeyException e) {
            // 之前被封过（uk_community_user）：覆盖那一行，而不是再插一条。
            // 让唯一键做最终裁判，与成员表的 revive 同一手法
            banMapper.reban(community.getId(), targetUserId, operatorId, reason, expiresAt, now);
        }

        String detail = durationDays == null ? "永久封禁" : "封禁 " + durationDays + " 天";
        historyMapper.insert(CommunityHistory.of(community.getId(),
                CommunityHistory.EVENT_MEMBER_BANNED, CommunityHistory.CATEGORY_MODERATION,
                operatorId, targetUserId, reason == null ? detail : detail + "：" + reason));

        log.info("社群封禁 id={} operatorId={} targetUserId={} durationDays={}",
                community.getId(), operatorId, targetUserId, durationDays);
        return new CommunityBanView(targetUserId, operatorId, reason, now, expiresAt);
    }

    /**
     * 解封。**幂等**：没被封、或封禁已自然过期，都直接成功返回。
     *
     * 只有真的把一条生效中的封禁置为已解封时才写 MEMBER_UNBANNED ——
     * 否则时间线里会出现"解除了一个本来就没封的人"这种没人能解释的记录。
     */
    @Transactional
    public void unban(Long operatorId, String name, Long targetUserId) {
        Community community = requireAdminForUpdate(operatorId, name);
        LocalDateTime now = LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS);
        if (banMapper.liftActive(community.getId(), targetUserId, operatorId, now) == 1) {
            historyMapper.insert(CommunityHistory.of(community.getId(),
                    CommunityHistory.EVENT_MEMBER_UNBANNED, CommunityHistory.CATEGORY_MODERATION,
                    operatorId, targetUserId, "解除社群封禁"));
            log.info("社群解封 id={} operatorId={} targetUserId={}",
                    community.getId(), operatorId, targetUserId);
        } else {
            log.info("无需解封（未生效封禁）id={} targetUserId={}", community.getId(), targetUserId);
        }
    }

    // --------------------------------------------------------------- 编年史

    /**
     * 社群时间线（游客可读）。
     *
     * {@code category} 接受 all / milestone / moderation；未知值 → 40010，
     * 而不是静默当成 all —— 前端拼错枚举时，静默降级会让"治理记录"页显示
     * 全部事件，而看不出来筛选没生效。
     *
     * 游标绑定分类（见 SORT_HISTORY_PREFIX）：跨分类复用返回 40010。
     */
    public PageResult<CommunityHistoryView> history(String name, String category,
                                                    String cursor, Integer limit) {
        Community community = communityService.requireByName(name);
        String normalized = normalizeCategory(category);
        int size = Paging.normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_HISTORY_PREFIX + normalized);

        LambdaQueryWrapper<CommunityHistory> q = new LambdaQueryWrapper<CommunityHistory>()
                .eq(CommunityHistory::getCommunityId, community.getId());
        String dbCategory = apiCategoryToDb(normalized);
        if (dbCategory != null) {
            q.eq(CommunityHistory::getCategory, dbCategory);
        }
        if (c != null) {
            LocalDateTime ts = Paging.fromMillis(c.timestampMillis());
            q.and(w -> w.lt(CommunityHistory::getCreatedAt, ts)
                    .or(x -> x.eq(CommunityHistory::getCreatedAt, ts)
                            .lt(CommunityHistory::getId, c.id())));
        }
        q.orderByDesc(CommunityHistory::getCreatedAt).orderByDesc(CommunityHistory::getId);

        List<CommunityHistory> rows = historyMapper.selectList(q.last("LIMIT " + (size + 1)));
        boolean hasMore = rows.size() > size;
        List<CommunityHistory> page = hasMore ? rows.subList(0, size) : rows;

        List<CommunityHistoryView> items = new ArrayList<>(page.size());
        for (CommunityHistory row : page) {
            items.add(CommunityHistoryView.of(row));
        }
        String next = null;
        if (hasMore) {
            CommunityHistory last = page.get(page.size() - 1);
            next = CursorCodec.encode(SORT_HISTORY_PREFIX + normalized,
                    Paging.toMillis(last.getCreatedAt()), last.getId());
        }
        return PageResult.of(items, next);
    }

    /**
     * 历代管理员（游客可读）。
     *
     * **不存任期表**，从事件流推：COMMUNITY_CREATED 是首任，每条
     * ADMIN_TRANSFERRED 开启下一任，下一任的开始时间就是上一任的结束时间。
     * 存一张任期表意味着两处状态永远可能对不上，而事件流才是事实来源。
     *
     * 正序（created_at ASC, id ASC）：同毫秒内的两次事件靠雪花 id 打破平局，
     * 与 idx_community_event_created 的排序一致。
     */
    public AdminHistoryView adminHistory(String name) {
        Community community = communityService.requireByName(name);
        List<CommunityHistory> events = historyMapper.selectList(
                new LambdaQueryWrapper<CommunityHistory>()
                        .eq(CommunityHistory::getCommunityId, community.getId())
                        .in(CommunityHistory::getEventType, List.of(
                                CommunityHistory.EVENT_COMMUNITY_CREATED,
                                CommunityHistory.EVENT_ADMIN_TRANSFERRED))
                        .orderByAsc(CommunityHistory::getCreatedAt)
                        .orderByAsc(CommunityHistory::getId));

        List<AdminTermView> items = new ArrayList<>(events.size());
        for (int i = 0; i < events.size(); i++) {
            CommunityHistory event = events.get(i);
            // 创建事件的两个 id 都是创建者；转让事件的 target 才是新管理员。
            // 统一取 target，回填/应用层都保证它非空
            Long adminId = event.getTargetUserId() != null
                    ? event.getTargetUserId()
                    : event.getOperatorId();
            LocalDateTime endedAt = i + 1 < events.size() ? events.get(i + 1).getCreatedAt() : null;
            items.add(new AdminTermView(items.size() + 1, adminId, event.getCreatedAt(),
                    endedAt, endedAt == null));
        }

        // 兜底：事件流里没有 COMMUNITY_CREATED（理论上只有 V2 回填漏掉的脏数据才会出现）
        // 时仍然回答"现任管理员是谁"，而不是给前端一个空区块
        if (items.isEmpty()) {
            items.add(new AdminTermView(1, community.getOwnerId(), community.getCreatedAt(),
                    null, true));
        }
        return new AdminHistoryView(items);
    }

    // --------------------------------------------------------------- 内部工具

    /** 只读场景的管理员校验：不加锁 */
    private Community requireAdmin(Long operatorId, String name) {
        Community community = communityService.requireByName(name);
        if (!community.getOwnerId().equals(operatorId)) {
            throw new BizException(CommunityErrorCode.NOT_COMMUNITY_ADMIN);
        }
        return community;
    }

    /**
     * 写场景的管理员校验：先按名取社群并**加行锁**，再校验身份。
     *
     * 顺序不能反：先校验身份就必须先读一次社群（无锁），再为了加锁读第二次，
     * 两次之间 owner 可能已经转让给别人 —— 那时被锁住的是"已经不当管理员的人"。
     * 一次带锁的读同时解决"取社群"和"谁是管理员"。
     */
    private Community requireAdminForUpdate(Long operatorId, String name) {
        Community community = communityService.requireByNameForUpdate(name);
        if (!community.getOwnerId().equals(operatorId)) {
            throw new BizException(CommunityErrorCode.NOT_COMMUNITY_ADMIN);
        }
        return community;
    }

    private boolean isActiveMember(Long communityId, Long userId) {
        Long count = memberMapper.selectCount(new LambdaQueryWrapper<CommunityMember>()
                .eq(CommunityMember::getCommunityId, communityId)
                .eq(CommunityMember::getUserId, userId)
                .eq(CommunityMember::getStatus, CommunityMember.STATUS_ACTIVE));
        return count != null && count > 0;
    }

    /**
     * null 保持原值，空串清空，其余 trim。
     *
     * 只传了公告的一次保存，不能顺手把头像抹掉 —— 见 UpdateCommunityInfoRequest。
     */
    private static String normalizeText(String raw, String current) {
        if (raw == null) {
            return current;
        }
        String trimmed = raw.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * 头像只收 http/https 外链。
     *
     * 白名单而不是黑名单：前端会把它塞进 {@code <img src>}，任何
     * {@code javascript:} / {@code data:} 变体都不该有机会到浏览器。
     * 服务端不下载、不校验可达性 —— 头像挂了是展示问题，不是数据问题。
     */
    private static void requireSafeAvatarUrl(String avatarUrl) {
        if (avatarUrl == null) {
            return;
        }
        String lower = avatarUrl.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "头像链接必须以 http:// 或 https:// 开头");
        }
    }

    private static String normalizeReason(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.length() > MAX_REASON_LENGTH) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "封禁原因不能超过 200 字");
        }
        return trimmed;
    }

    /** 查询用的分类参数归一：null/空 → all，未知 → 40010 */
    private static String normalizeCategory(String category) {
        if (category == null || category.isBlank()) {
            return QUERY_CATEGORY_ALL;
        }
        String normalized = category.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case QUERY_CATEGORY_ALL, QUERY_CATEGORY_MILESTONE, QUERY_CATEGORY_MODERATION -> normalized;
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "分类只能是 all、milestone 或 moderation");
        };
    }

    /** 查询分类 → 库里的 category 值；all 返回 null 表示不过滤 */
    private static String apiCategoryToDb(String normalized) {
        return switch (normalized) {
            case QUERY_CATEGORY_MILESTONE -> CommunityHistory.CATEGORY_MILESTONE;
            case QUERY_CATEGORY_MODERATION -> CommunityHistory.CATEGORY_MODERATION;
            default -> null;
        };
    }
}
