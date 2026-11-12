package top.katzenyasax.kuaikan.community.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 社群。与 t_community 一一对应。
 *
 * 注意这里**没有 slug**：社群名本身就是标识（name_key 是它的规范化形式）。
 * 也没有头像/封面/分类列 —— 加列便宜，猜错的列才是负担，等 P7 真做上传时再加。
 */
@TableName("t_community")
public class Community {

    public static final int STATUS_NORMAL = 1;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 展示名，用户输入原文（trim 后）。创建后不可改 */
    private String name;

    /** 规范化唯一键：NFKC + trim + lower + 连续空白转 "-"。URL 用它 */
    private String nameKey;

    private String description;

    /** 所有者。社群的属性，不是成员角色 —— 每个社群恰好一个 */
    private Long ownerId;

    /** 成员数，唯一写入者是本服务，与成员行同一本地事务 */
    private Integer memberCount;

    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getNameKey() { return nameKey; }
    public void setNameKey(String nameKey) { this.nameKey = nameKey; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Long getOwnerId() { return ownerId; }
    public void setOwnerId(Long ownerId) { this.ownerId = ownerId; }
    public Integer getMemberCount() { return memberCount; }
    public void setMemberCount(Integer memberCount) { this.memberCount = memberCount; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
