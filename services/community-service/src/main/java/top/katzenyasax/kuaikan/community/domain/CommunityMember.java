package top.katzenyasax.kuaikan.community.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 社群成员。
 *
 * 所有者**不在这里**用 role 表达，而是 t_community.owner_id —— MySQL 没有
 * "每个社群只能有一行 role=OWNER"的部分唯一索引，那样只能靠应用层保证唯一。
 */
@TableName("t_community_member")
public class CommunityMember {

    public static final int ROLE_MEMBER = 0;
    public static final int ROLE_MODERATOR = 1;

    public static final int STATUS_ACTIVE = 1;
    public static final int STATUS_LEFT = 0;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long communityId;

    private Long userId;

    /** 0 成员 / 1 管理员。P2 恒为 0，写入者在 P7 */
    private Integer role;

    /** 1 在社 / 0 已退出。退出用软删，因为 member_count 的增减要靠状态判断 */
    private Integer status;

    /** 由数据库默认值填充。审计处理器只填 createdAt/updatedAt，这里刻意不挂 fill */
    private LocalDateTime joinedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getCommunityId() { return communityId; }
    public void setCommunityId(Long communityId) { this.communityId = communityId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Integer getRole() { return role; }
    public void setRole(Integer role) { this.role = role; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public LocalDateTime getJoinedAt() { return joinedAt; }
    public void setJoinedAt(LocalDateTime joinedAt) { this.joinedAt = joinedAt; }
}
