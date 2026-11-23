package top.katzenyasax.kuaikan.community.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 社群历史事件。与 t_community_history 一一对应。
 *
 * **只追加，永不更新**：这是编年史，不是业务状态。任何一个"改一下那条历史"的
 * 需求，正确做法都是追加一条新事件（比如解封不是把封禁事件删掉，而是再加一条
 * MEMBER_UNBANNED）。
 *
 * category 是冗余列（由 event_type 决定），但它是查询维度：
 * 前端「全部 / 大事记 / 治理记录」三个页签直接对应它，也对应索引
 * idx_community_cat_created。推导意味着每次查询都要写一长串 IN。
 *
 * 这条流**不跨服务**：管理员删帖/删评（content-service）刻意不写社群历史，
 * 否则 content 就要反向依赖 community 的写路径（p7-community-admin.md §1.2）。
 */
@TableName("t_community_history")
public class CommunityHistory {

    public static final String EVENT_COMMUNITY_CREATED = "COMMUNITY_CREATED";
    public static final String EVENT_ADMIN_TRANSFERRED = "ADMIN_TRANSFERRED";
    public static final String EVENT_INFO_UPDATED = "INFO_UPDATED";
    public static final String EVENT_MEMBER_BANNED = "MEMBER_BANNED";
    public static final String EVENT_MEMBER_UNBANNED = "MEMBER_UNBANNED";

    public static final String CATEGORY_MILESTONE = "MILESTONE";
    public static final String CATEGORY_MODERATION = "MODERATION";

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long communityId;

    private String eventType;

    /** MILESTONE / MODERATION，见类注释 */
    private String category;

    /** 操作人。创建社群时是创建者，其余事件是当时的管理员 */
    private Long operatorId;

    /** 事件对象。INFO_UPDATED 为 NULL，其余是创建者/新管理员/被封禁者 */
    private Long targetUserId;

    /** 给人看的一句话，例：`封禁 7 天：发布广告` */
    private String detail;

    /** 由审计填充器写入（截到毫秒，与库里 DATETIME(3) 对齐） */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 一条待插入的事件。id 留空交给 BaseMapper.insert 按服务配置的
     * ID_WORKER_ID 分配（与成员行同样的理由：自己生成会绕开 worker-id 分配）。
     */
    public static CommunityHistory of(Long communityId, String eventType, String category,
                                      Long operatorId, Long targetUserId, String detail) {
        CommunityHistory event = new CommunityHistory();
        event.setCommunityId(communityId);
        event.setEventType(eventType);
        event.setCategory(category);
        event.setOperatorId(operatorId);
        event.setTargetUserId(targetUserId);
        event.setDetail(detail);
        return event;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getCommunityId() { return communityId; }
    public void setCommunityId(Long communityId) { this.communityId = communityId; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public Long getOperatorId() { return operatorId; }
    public void setOperatorId(Long operatorId) { this.operatorId = operatorId; }
    public Long getTargetUserId() { return targetUserId; }
    public void setTargetUserId(Long targetUserId) { this.targetUserId = targetUserId; }
    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
