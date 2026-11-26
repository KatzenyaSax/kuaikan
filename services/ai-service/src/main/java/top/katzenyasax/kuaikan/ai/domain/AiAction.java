package top.katzenyasax.kuaikan.ai.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("t_ai_action")
public class AiAction {

    public static final String STATUS_PROPOSED = "PROPOSED";
    public static final String STATUS_EXECUTED = "EXECUTED";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_REJECTED = "REJECTED";
    public static final String STATUS_EXPIRED = "EXPIRED";

    public static final String TYPE_CREATE_POST = "CREATE_POST";
    public static final String TYPE_FAVORITE_POSTS = "FAVORITE_POSTS";
    public static final String TYPE_FOLLOW_USER = "FOLLOW_USER";
    public static final String TYPE_JOIN_COMMUNITY = "JOIN_COMMUNITY";
    public static final String TYPE_UPDATE_NICKNAME = "UPDATE_NICKNAME";
    public static final String TYPE_UPDATE_AVATAR = "UPDATE_AVATAR";
    public static final String TYPE_SAVE_PROFILE_ENTRY = "SAVE_PROFILE_ENTRY";

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long conversationId;
    private Long messageId;
    private Long userId;
    private String type;
    private String payload;
    private String status;
    private String result;
    private LocalDateTime expiresAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getConversationId() { return conversationId; }
    public void setConversationId(Long conversationId) { this.conversationId = conversationId; }

    public Long getMessageId() { return messageId; }
    public void setMessageId(Long messageId) { this.messageId = messageId; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getResult() { return result; }
    public void setResult(String result) { this.result = result; }

    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
