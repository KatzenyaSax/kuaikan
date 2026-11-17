package top.katzenyasax.kuaikan.common.mq;

/**
 * 账号被封禁。
 *
 * <b>为什么这条事件值得单独存在</b>：它是唯一一条"平台对用户做的事"，
 * 而不是"其他用户对用户做的事"。所以它落到 SYSTEM 分类，
 * 文案也不一样（不是"某人赞了你"，而是"你的账号被封禁"）。
 *
 * <h2>一个反直觉的后果</h2>
 *
 * 封禁的同时会踢下线并拒绝后续登录，所以**用户在被封期间看不到这条消息**。
 * 它实际上是一份事后可见的审计记录：解封后登录，能看到"你因某某原因被封禁"。
 *
 * 这不是设计缺陷，而是刻意的——把封禁原因写成用户可见的记录，
 * 比只留在运维日志里更负责任。
 *
 * @param eventId   幂等唯一键
 * @param occurredAt epoch 毫秒
 * @param userId    被封禁的人（也是消息的接收人）
 * @param reason    封禁原因。可能为空，文案由前端兜底
 */
public record UserBanned(
        String eventId,
        long occurredAt,
        String userId,
        String reason
) {
}
