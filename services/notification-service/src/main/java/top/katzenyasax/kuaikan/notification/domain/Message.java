package top.katzenyasax.kuaikan.notification.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 一条投递给人看的消息。
 *
 * <b>所有 actor/target 字段都是快照，不是外键。</b>
 * 写入那一刻固化成字符串，之后对方改名、删帖子都不影响这条历史记录。
 */
@TableName("t_message")
public class Message {

    /** 四种类型。**刻意用字符串而不是枚举序号**：排查时 SELECT type 一眼就懂 */
    public static final String TYPE_LIKE = "LIKE";
    public static final String TYPE_COMMENT = "COMMENT";
    public static final String TYPE_MENTION = "MENTION";
    /** P5.5：关注。与点赞/评论不同，它**不折叠**（每条都是一次可回关的具体关系） */
    public static final String TYPE_FOLLOW = "FOLLOW";
    public static final String TYPE_SYSTEM = "SYSTEM";

    public static final String TARGET_POST = "POST";
    public static final String TARGET_COMMENT = "COMMENT";
    /** 关注消息的目标是「人」。跳转直接用 actorId（/u/{actorId}） */
    public static final String TARGET_USER = "USER";

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;
    private String type;

    /** 幂等键。与 user_id 组成唯一索引，挡住了重复投递 */
    private String sourceEventId;

    private Long actorId;
    private String actorNickname;
    private String actorAvatar;

    private String targetType;
    private Long targetId;
    private String targetTitle;
    /** 跳转用的三个字段。快照，不随目标变化 */
    private String communityName;
    private Long postId;
    private Long commentId;
    /** 回复所在的一级评论 id。前端要先展开它，才能滚到那条回复 */
    private Long rootCommentId;
    private String excerpt;

    private LocalDateTime readAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getSourceEventId() { return sourceEventId; }
    public void setSourceEventId(String sourceEventId) { this.sourceEventId = sourceEventId; }
    public Long getActorId() { return actorId; }
    public void setActorId(Long actorId) { this.actorId = actorId; }
    public String getActorNickname() { return actorNickname; }
    public void setActorNickname(String actorNickname) { this.actorNickname = actorNickname; }
    public String getActorAvatar() { return actorAvatar; }
    public void setActorAvatar(String actorAvatar) { this.actorAvatar = actorAvatar; }
    public String getTargetType() { return targetType; }
    public void setTargetType(String targetType) { this.targetType = targetType; }
    public Long getTargetId() { return targetId; }
    public void setTargetId(Long targetId) { this.targetId = targetId; }
    public String getTargetTitle() { return targetTitle; }
    public void setTargetTitle(String targetTitle) { this.targetTitle = targetTitle; }
    public String getCommunityName() { return communityName; }
    public void setCommunityName(String communityName) { this.communityName = communityName; }
    public Long getPostId() { return postId; }
    public void setPostId(Long postId) { this.postId = postId; }
    public Long getCommentId() { return commentId; }
    public void setCommentId(Long commentId) { this.commentId = commentId; }
    public Long getRootCommentId() { return rootCommentId; }
    public void setRootCommentId(Long rootCommentId) { this.rootCommentId = rootCommentId; }
    public String getExcerpt() { return excerpt; }
    public void setExcerpt(String excerpt) { this.excerpt = excerpt; }
    public LocalDateTime getReadAt() { return readAt; }
    public void setReadAt(LocalDateTime readAt) { this.readAt = readAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
