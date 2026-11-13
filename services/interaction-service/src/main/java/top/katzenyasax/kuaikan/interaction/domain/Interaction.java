package top.katzenyasax.kuaikan.interaction.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 互动事实：谁对什么做了点赞/收藏。
 *
 * **取消是物理删除**，不是软删。因为接口语义是"设为已赞/未赞"而不是"翻转"，
 * 于是"有没有这一行"就是唯一的事实，重复与取消都靠 affectedRows 判断。
 * （t_community_member 必须软删，是因为那里的唯一键要表达"退出过"，性质不同。）
 */
@TableName("t_interaction")
public class Interaction {

    public static final int KIND_LIKE = 1;
    public static final int KIND_FAVORITE = 2;

    public static final int TARGET_POST = 1;
    public static final int TARGET_COMMENT = 2;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;

    /** 见 KIND_* */
    private Integer kind;

    /** 见 TARGET_* */
    private Integer targetType;

    private Long targetId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Integer getKind() { return kind; }
    public void setKind(Integer kind) { this.kind = kind; }
    public Integer getTargetType() { return targetType; }
    public void setTargetType(Integer targetType) { this.targetType = targetType; }
    public Long getTargetId() { return targetId; }
    public void setTargetId(Long targetId) { this.targetId = targetId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
