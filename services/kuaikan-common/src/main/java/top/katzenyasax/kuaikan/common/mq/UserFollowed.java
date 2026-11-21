package top.katzenyasax.kuaikan.common.mq;

/**
 * 关注事件（P5.5）。载荷对应 topic {@link Topics#USER_FOLLOWED}。
 *
 * <b>为什么由 user-service 发</b>：关注关系是「用户对用户做的事」，
 * 聚合归属 user-service（{@code t_user_follow}），与 content 发评论事件同一原则——边界按聚合划。
 *
 * <h2>为什么 followerNickname / followerAvatar 进载荷</h2>
 *
 * user-service 自己就是 {@code t_user} 的所有者，写 outbox 的同一事务里就能拿到快照，
 * 不需要额外一次查询。若让 notification-service 收到事件后回调 user-service 查头像昵称，
 * 关注消息的可用性就被 user-service 的健康度二次绑定，且拿到的可能是「现在」而非「当时」的昵称。
 * 快照进载荷让消息成为自包含的历史记录（不变量 9）。
 *
 * 这与 {@code CommentCreated} 不带评论者昵称并不矛盾：content 不是 {@code t_user} 的所有者，
 * 它拿昵称必须跨服务调用；user-service 拿自己是零成本。
 *
 * <h2>为什么 id 一律 String</h2>
 *
 * 同 {@link CommentCreated}：web 层 ObjectMapper 把 Long 序列化成 String（JacksonConfig），
 * MQ 层不用那个配置，同一种 Long 在两处类型不同，而反序列化失败只在运行时暴露。
 *
 * @param eventId         幂等唯一键。在写 outbox 的同一事务里生成，重投时保持不变
 * @param occurredAt      epoch 毫秒。不用 Instant，避免两侧序列化配置不同
 * @param followerId      关注者（消息的 actor，也是点击跳转 /u/{actorId} 的目标）
 * @param followeeId      被关注者（消息的接收人）
 * @param followerNickname 关注者昵称快照，可为空
 * @param followerAvatar  关注者头像快照，可为空
 */
public record UserFollowed(
        String eventId,
        long occurredAt,
        String followerId,
        String followeeId,
        String followerNickname,
        String followerAvatar
) {
}
