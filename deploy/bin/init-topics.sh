#!/usr/bin/env bash
# 显式创建 RocketMQ topic。幂等。
#
#   ./deploy/bin/init-topics.sh
#
# 为什么必须显式建，而不是依赖 broker 的 autoCreateTopicEnable：
#
# **消费者在 topic 存在之前订阅，之后不会自己拿到路由。**
# 实测：interaction-service 发出第一条事件时 broker 自动创建了 topic，
# 但先启动的 content-service 消费者一直没有消费，直到重启才把积压的消息读走。
#
# 这在第一次上线时就是"点赞了但计数永远不动"，而且所有接口都返回成功，
# 从外面完全看不出问题。所以 topic 必须在**服务启动之前**就存在。
#
# 注意：RocketMQ 的 topic 名校验是 ^[%|a-zA-Z0-9_-]+$ —— 不允许点号，
# 所以 Topics.java 里用下划线。这个脚本的列表要与那个文件保持一致。
set -euo pipefail

BROKER_CONTAINER="${BROKER_CONTAINER:-kuaikan-rmq-broker-1}"
NAMESRV="${NAMESRV:-rmq-namesrv:9876}"
CLUSTER="${CLUSTER:-KuaikanCluster}"

# 与 services/kuaikan-common/.../mq/Topics.java 保持同步
TOPICS=(
  "kuaikan_p0_smoke"
  "kuaikan_interaction_changed"
)

mqadmin() {
  docker exec "$BROKER_CONTAINER" sh -c \
    "cd /home/rocketmq/rocketmq-5.3.4/bin && sh mqadmin $* -n $NAMESRV" 2>/dev/null
}

if ! docker ps --filter "name=$BROKER_CONTAINER" --filter "status=running" -q | grep -q .; then
  echo "✗ $BROKER_CONTAINER 没在运行，先起 core profile" >&2
  exit 1
fi

for topic in "${TOPICS[@]}"; do
  # updateTopic 是幂等的：已存在则更新配置，不会报错
  if mqadmin "updateTopic -c $CLUSTER -t $topic -r 8 -w 8" >/dev/null; then
    printf '  ✓ %s\n' "$topic"
  else
    printf '  ✗ %s 创建失败\n' "$topic" >&2
    exit 1
  fi
done

echo "topic 就绪（${#TOPICS[@]} 个）"
