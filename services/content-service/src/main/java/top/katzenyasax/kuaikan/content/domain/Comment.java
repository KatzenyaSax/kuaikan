package top.katzenyasax.kuaikan.content.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 评论。与 t_comment 一一对应。
 *
 * 三个"回复"字段连起来读：这条评论属于 {@code rootCommentId} 这个主楼，
 * 回复的是 {@code replyToCommentId}，回复给 {@code replyToUserId} 这个人。
 * 一级评论三者全为 NULL。
 */
@TableName("t_comment")
public class Comment {

    public static final int STATUS_NORMAL = 1;
    /** 已删除，但因为有回复而保留了行（tombstone） */
    public static final int STATUS_DELETED = 0;
    /** 已隐藏（P7） */
    public static final int STATUS_HIDDEN = 2;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long postId;

    /** 所属一级评论；一级评论自身为 NULL */
    private Long rootCommentId;

    /** 直接回复的评论；一级评论为 NULL */
    private Long replyToCommentId;

    /** 直接回复的人；一级评论为 NULL */
    private Long replyToUserId;

    private Long authorId;

    private String body;

    private Integer likeCount;

    /** 该一级评论下的全部可见回复数 */
    private Integer replyCount;

    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public boolean isTopLevel() {
        return rootCommentId == null;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getPostId() { return postId; }
    public void setPostId(Long postId) { this.postId = postId; }
    public Long getRootCommentId() { return rootCommentId; }
    public void setRootCommentId(Long rootCommentId) { this.rootCommentId = rootCommentId; }
    public Long getReplyToCommentId() { return replyToCommentId; }
    public void setReplyToCommentId(Long replyToCommentId) { this.replyToCommentId = replyToCommentId; }
    public Long getReplyToUserId() { return replyToUserId; }
    public void setReplyToUserId(Long replyToUserId) { this.replyToUserId = replyToUserId; }
    public Long getAuthorId() { return authorId; }
    public void setAuthorId(Long authorId) { this.authorId = authorId; }
    public String getBody() { return body; }
    public void setBody(String body) { this.body = body; }
    public Integer getLikeCount() { return likeCount; }
    public void setLikeCount(Integer likeCount) { this.likeCount = likeCount; }
    public Integer getReplyCount() { return replyCount; }
    public void setReplyCount(Integer replyCount) { this.replyCount = replyCount; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
