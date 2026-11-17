package top.katzenyasax.kuaikan.common.mq;

import java.util.List;

/**
 * 评论 / 回复的发布事件。
 *
 * <b>这是跨服务契约，放在 common 里是有意的</b>：生产者（content）与消费者
 * （notification）必须对字段完全一致，共享同一个 record 能让任何一侧的改动在
 * <b>编译期</b>就炸出来，而不是等运行时 JSON 对不上。理由同 {@link InteractionChange}。
 *
 * <h2>为什么字段类型大多是 String</h2>
 *
 * id 都是雪花 Long，但 web 层与 MQ 层的 ObjectMapper 不是同一个：
 * web 层有 JacksonConfig（Long → String），MQ 序列化用 RocketMQ 自带的，
 * 不受那个配置影响。同一种 Long 在两处会序列化成不同类型，
 * 而消费端反序列化失败是<b>运行时</b>才暴露的。所以载荷里的 id 一律 String。
 *
 * <h2>为什么带 excerpt</h2>
 *
 * 消息要显示"某某评论了什么"。如果只给 commentId，消费者要回查正文——
 * 而正文可能已被编辑或删除，消息需要的却是"当时说了什么"。
 * excerpt 直接进快照，让消息成为自包含的历史记录（不变量 9）。
 *
 * <h2>为什么不带 comment 作者的昵称/头像</h2>
 *
 * 那两个由消费者拉取，理由见 ADR 0009 的反向论证：
 * 若写进载荷，content 的评论路径就要依赖 user-service，
 * 而"评论能不能发出去"不该由用户服务的健康度决定。
 *
 * @param eventId        幂等唯一键。在写 outbox 的同一事务里生成，重投时保持不变
 * @param occurredAt     epoch 毫秒。不用 Instant，避免两侧序列化配置不同
 * @param actorId        写这条评论的人。**P4.3 补上的**：
 *                       没有它，消费者既不知道"是谁评论的"（消息里要显示），
 *                       也没法做自抑制（自己评论自己的帖子不该给自己发消息）。
 *                       这是一个真实的设计缺口，不是后来想加的功能。
 * @param commentId      新评论
 * @param postId         所在帖子
 * @param communityId    所在社群。消费方判断 @ 的有效范围时要用（@ 只对本社群成员生效）
 * @param postAuthorId   帖子作者，收 COMMENT（"评论了你的帖子"）
 * @param replyToUserId  被回复的评论作者，收 COMMENT（"回复了你的评论"）；顶层评论为 null
 * @param mentionUserIds 正文里 @ 到的人，收 MENTION。已由 content 解析并校验过社群成员身份
 * @param excerpt        正文摘录，进消息快照
 */
public record CommentCreated(
        String eventId,
        long occurredAt,
        String actorId,
        String commentId,
        String postId,
        String communityId,
        String postAuthorId,
        String replyToUserId,
        List<String> mentionUserIds,
        String excerpt
) {
}
