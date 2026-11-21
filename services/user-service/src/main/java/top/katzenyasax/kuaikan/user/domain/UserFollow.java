package top.katzenyasax.kuaikan.user.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 关注关系：follower 关注了 followee。
 *
 * <b>取关是物理删除</b>（与 t_interaction 取消点赞同一套语义）：
 * 接口是「设为关注 / 设为未关注」而不是「翻转」，所以「有没有这一行」就是唯一的事实。
 * 重复关注靠 {@code uk_follower_followee} + INSERT IGNORE 的 affectedRows 判定，
 * 只有真的插进去（=1）才写 outbox 事件。
 */
@TableName("t_user_follow")
public class UserFollow {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 关注者。来自网关注入的 UserContext，不来自请求体 */
    private Long followerId;

    /** 被关注者。来自路径里的 userId */
    private Long followeeId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getFollowerId() { return followerId; }
    public void setFollowerId(Long followerId) { this.followerId = followerId; }
    public Long getFolloweeId() { return followeeId; }
    public void setFolloweeId(Long followeeId) { this.followeeId = followeeId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
