#!/usr/bin/env bash
# 拉代码 → 构建 → 启动 → 等待健康。幂等。
#
#   ./deploy/bin/up.sh core        只起中间件
#   ./deploy/bin/up.sh app         只起 8 个服务（先 core 得已在跑）
#   ./deploy/bin/up.sh all         全部
#   ./deploy/bin/up.sh gateway     只重建并重启单个服务
#
# 注意：镜像只能在服务器上构建（本地 arm64，服务器 x86_64，见 ADR 0007）。
set -euo pipefail

REPO="${REPO:-/opt/kuaikan/repo}"
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"
COMPOSE="$REPO/deploy/compose/compose.yml"
TARGET="${1:-all}"

[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE，先跑 deploy/bin/gen-env.sh" >&2; exit 1; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" "$@"
}

wait_healthy() {
  local names="$*" deadline=$((SECONDS + ${WAIT_TIMEOUT:-300}))
  while :; do
    local bad=""
    for n in $names; do
      local s
      s=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "kuaikan-$n" 2>/dev/null || echo "missing")
      [ "$s" = "healthy" ] || bad="$bad $n($s)"
    done
    [ -z "$bad" ] && { echo "==> 全部 healthy：$names"; return 0; }
    if [ $SECONDS -ge $deadline ]; then
      echo "==> 超时，未就绪：$bad" >&2
      compose ps >&2
      return 1
    fi
    sleep 5
  done
}

echo "==> git pull"
git -C "$REPO" fetch -q origin
git -C "$REPO" reset -q --hard origin/main
git -C "$REPO" log --oneline -1

case "$TARGET" in
  core)
    echo "==> 启动 core"
    compose --profile core up -d
    wait_healthy mysql redis nacos rmq-namesrv rmq-broker
    ;;
  app)
    echo "==> 构建并启动 app"
    compose --profile app up -d --build
    wait_healthy gateway user-service community-service content-service interaction-service notification-service search-service rank-service
    ;;
  all)
    echo "==> 启动 core"
    compose --profile core up -d
    wait_healthy mysql redis nacos rmq-namesrv rmq-broker
    echo "==> 构建并启动 app"
    compose --profile app up -d --build
    wait_healthy gateway user-service community-service content-service interaction-service notification-service search-service rank-service
    ;;
  *)
    echo "==> 重建单个服务：$TARGET"
    compose --profile app up -d --build "$TARGET"
    wait_healthy "$TARGET"
    ;;
esac

echo
compose ps
