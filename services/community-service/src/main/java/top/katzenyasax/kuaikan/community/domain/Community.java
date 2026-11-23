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
 * 名称也因此不可改 —— 它已经是 URL（`/c/{name}`）与消息/搜索快照的一部分。
 *
 * 可编辑的是三样展示信息（P7.1）：简介、头像外链、公告。头像只存外链不存文件，
 * 上传是另一个问题（对象存储、审核、迁移），不该把 t_community 绑上去。
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

    /** 头像外链 URL。NULL 表示没设置，前端回落成社群名首字母 */
    private String avatarUrl;

    /** 公告/规则。纯文本，NULL 表示没有公告 */
    private String announcement;

    /**
     * 管理员（所有者）。社群的属性，不是成员角色 —— 每个社群恰好一个。
     * 转让 = 改这一列，成员行不动（P7 保持单一管理员制）。
     */
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
    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
    public String getAnnouncement() { return announcement; }
    public void setAnnouncement(String announcement) { this.announcement = announcement; }
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
