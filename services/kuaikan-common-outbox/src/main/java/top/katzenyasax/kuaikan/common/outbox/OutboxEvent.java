package top.katzenyasax.kuaikan.common.outbox;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 待投递事件。`t_outbox` 一行的实体。
 *
 * <b>每个服务在自己的 schema 里建自己的 {@code t_outbox}</b>，结构完全一致。
 * 模块只提供代码，不提供迁移脚本 —— 因为 outbox 必须与业务数据在**同一个库、
 * 同一个事务**里，跨服务共用一张表就回到了共享数据库。
 *
 * 建表语句见任一使用者服务的 Flyway 迁移（如 interaction V1、content V4）。
 */
@TableName("t_outbox")
public class OutboxEvent {

    /** 待投递 */
    public static final int STATUS_PENDING = 0;
    /** 已投递 */
    public static final int STATUS_SENT = 1;
    /** 超过重试上限，放弃。放弃后事件就真丢了 —— 这正是对账不是可选项的原因 */
    public static final int STATUS_ABANDONED = 2;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 重投时保持不变 —— 这是消费端幂等的前提。换了 id 就等于换了一个事件 */
    private String eventId;

    private String topic;

    /** 序列化后的事件快照。投递时原样发出，不回查业务表 */
    private String payload;

    /** 见 STATUS_* */
    private Integer status;

    private Integer retryCount;

    private LocalDateTime nextRetryAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getEventId() { return eventId; }
    public void setEventId(String eventId) { this.eventId = eventId; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public Integer getRetryCount() { return retryCount; }
    public void setRetryCount(Integer retryCount) { this.retryCount = retryCount; }
    public LocalDateTime getNextRetryAt() { return nextRetryAt; }
    public void setNextRetryAt(LocalDateTime nextRetryAt) { this.nextRetryAt = nextRetryAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
