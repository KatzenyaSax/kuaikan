package top.katzenyasax.kuaikan.common.mq;

/**
 * 个人私密笔记变更事件（P9.0）。载荷对应 topic {@link Topics#NOTE_CHANGED}。
 *
 * <p>生产方 {@code ai-service}，消费方 {@code search-service}。
 * 载荷刻意只传 {@code noteId} 与 {@code ownerId}，不放正文，既防止私密笔记内容落盘到
 * RocketMQ commitlog，也使消费方永远回查 MySQL 最新状态而天然免疫消息乱序。
 *
 * @param eventId    幂等唯一键，在写 outbox 的同一事务里生成
 * @param occurredAt epoch 毫秒
 * @param noteId     发生新增、编辑、启停或硬删除的笔记 ID
 * @param ownerId    笔记所属用户 ID
 */
public record NoteChanged(
        String eventId,
        long occurredAt,
        String noteId,
        String ownerId
) {
}
