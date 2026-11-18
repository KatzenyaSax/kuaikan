package top.katzenyasax.kuaikan.content.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 帖子。与 t_post 一一对应。
 *
 * 注意这里**没有作者昵称/头像**，也没有任何计数列 —— 理由见 V1 迁移的注释。
 */
@TableName("t_post")
public class Post {

    public static final int STATUS_NORMAL = 1;
    public static final int STATUS_DELETED = 0;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 跨服务引用：community-service 的社群 id，没有外键 */
    private Long communityId;

    /** 作者。永远是网关注入的 UserContext，不接受调用方传 */
    private Long authorId;

    private String title;

    private String body;

    /** 评论总数。强一致计数，与评论写入同一本地事务 */
    private Integer commentCount;

    /** 点赞数 / 收藏数。最终一致，由 interaction 的事件投影（见 ADR 0010） */
    private Integer likeCount;
    private Integer favoriteCount;

    /** 累计浏览。不精确——Redis 缓冲后定期回写，Redis 挂了会丢一批 */
    private Integer viewCount;
    /** 累计分享 */
    private Integer shareCount;
    /** 最后一次互动时刻。热度的衰减基准（不是 created_at） */
    private LocalDateTime lastInteractionAt;

    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getCommunityId() { return communityId; }
    public void setCommunityId(Long communityId) { this.communityId = communityId; }
    public Long getAuthorId() { return authorId; }
    public void setAuthorId(Long authorId) { this.authorId = authorId; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getBody() { return body; }
    public void setBody(String body) { this.body = body; }
    public Integer getLikeCount() { return likeCount; }
    public void setLikeCount(Integer likeCount) { this.likeCount = likeCount; }
    public Integer getFavoriteCount() { return favoriteCount; }
    public void setFavoriteCount(Integer favoriteCount) { this.favoriteCount = favoriteCount; }
    public Integer getViewCount() { return viewCount; }
    public void setViewCount(Integer viewCount) { this.viewCount = viewCount; }
    public Integer getShareCount() { return shareCount; }
    public void setShareCount(Integer shareCount) { this.shareCount = shareCount; }
    public LocalDateTime getLastInteractionAt() { return lastInteractionAt; }
    public void setLastInteractionAt(LocalDateTime lastInteractionAt) { this.lastInteractionAt = lastInteractionAt; }
    public Integer getCommentCount() { return commentCount; }
    public void setCommentCount(Integer commentCount) { this.commentCount = commentCount; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
