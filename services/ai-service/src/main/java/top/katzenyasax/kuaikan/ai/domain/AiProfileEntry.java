package top.katzenyasax.kuaikan.ai.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("t_ai_profile_entry")
public class AiProfileEntry {

    public static final String CAT_IDENTITY = "IDENTITY";
    public static final String CAT_PREFERENCE = "PREFERENCE";
    public static final String CAT_STYLE = "STYLE";
    public static final String CAT_OTHER = "OTHER";

    public static final String SOURCE_MANUAL = "MANUAL";
    public static final String SOURCE_AI_CONFIRMED = "AI_CONFIRMED";

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;
    private String category;
    private String content;
    private Integer enabled;
    private String source;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public Integer getEnabled() { return enabled; }
    public void setEnabled(Integer enabled) { this.enabled = enabled; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
