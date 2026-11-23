package top.katzenyasax.kuaikan.community.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 社群内封禁。与 t_community_ban 一一对应。
 *
 * **一个 (社群, 用户) 只有一行**（uk_community_user）：重新封禁是覆盖这一行，
 * 不是再插一条。封禁史要读就去读 t_community_history 的 MEMBER_BANNED 事件——
 * 那是只追加的事件流，这张表只回答"此刻封没封、到什么时候"。
 *
 * 封禁只作用于**当前社群**：不影响登录，也不影响别的社群。
 *
 * 时间列全部 DATETIME(3) + {@link LocalDateTime}，与 t_community /
 * t_community_member 完全一致（JDBC 的 serverTimezone=Asia/Shanghai，
 * 应用层 LocalDateTime.now() 与 SQL 的 NOW(3) 落在同一时区）。
 */
@TableName("t_community_ban")
public class CommunityBan {

    public static final int STATUS_ACTIVE = 1;
    public static final int STATUS_LIFTED = 0;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long communityId;

    /** 被封禁的用户 */
    private Long userId;

    /** 执行封禁的管理员 */
    private Long bannedBy;

    /** 封禁原因，可空 */
    private String reason;

    /** NULL 表示永久封禁。限时封禁到期后自然失效，无需定时任务 */
    private LocalDateTime expiresAt;

    /** 1 生效中 / 0 已解封 */
    private Integer status;

    /** 本次封禁的开始时刻。重新封禁会把它推到最新一次，游标分页按它排序 */
    private LocalDateTime bannedAt;

    private LocalDateTime unbannedAt;

    private Long unbannedBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getCommunityId() { return communityId; }
    public void setCommunityId(Long communityId) { this.communityId = communityId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getBannedBy() { return bannedBy; }
    public void setBannedBy(Long bannedBy) { this.bannedBy = bannedBy; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public LocalDateTime getBannedAt() { return bannedAt; }
    public void setBannedAt(LocalDateTime bannedAt) { this.bannedAt = bannedAt; }
    public LocalDateTime getUnbannedAt() { return unbannedAt; }
    public void setUnbannedAt(LocalDateTime unbannedAt) { this.unbannedAt = unbannedAt; }
    public Long getUnbannedBy() { return unbannedBy; }
    public void setUnbannedBy(Long unbannedBy) { this.unbannedBy = unbannedBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
