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
POLL="${POLL_INTERVAL:-5}"

[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE，先跑 deploy/bin/gen-env.sh" >&2; exit 1; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" "$@"
}

# 等待一批服务 healthy。
#
# 设计要点（2026-11-08 的教训）：
#   1. 先打印状态再等待。旧版本沉默到超时才报错，容器在崩溃重启也完全看不见，
#      等于把故障藏起来了。
#   2. 容器名由 compose 生成为 <project>-<service>-<n>，不能拼名字，必须反查 ID。
#   3. 状态变化时立刻打印，此外每 30s 一行心跳：不刷屏，但绝不沉默。
#   4. 某个服务首次进入 restarting / exited / unhealthy 时，立刻喷它最近 12 行日志。
#   5. 超时后逐个打印失败服务的最后 30 行日志，而不是只报一个状态码。
wait_healthy() {
  local names="$*"
  local start=$SECONDS
  local timeout="${WAIT_TIMEOUT:-300}"
  local prev=""
  local last_beat=-999
  local -A dumped=()

  while :; do
    local elapsed=$((SECONDS - start))
    local line=""
    local bad=""
    local -A states=()

    for n in $names; do
      local cid state health exitcode
      cid=$(compose ps -q "$n" 2>/dev/null || true)
      if [ -z "$cid" ]; then
        states[$n]="missing"
        line="$line $n=missing"
        bad="$bad $n"
        continue
      fi

      read -r state exitcode < <(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$cid" 2>/dev/null || echo "unknown -1")
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)

      if [ "$state" = "running" ] && [ "$health" = "healthy" ]; then
        states[$n]="healthy"
        line="$line $n=healthy"
      elif [ "$state" = "restarting" ] || [ "$state" = "exited" ]; then
        states[$n]="${state}(${exitcode})"
        line="$line $n=${state}(${exitcode})"
        bad="$bad $n"
      elif [ "$state" = "running" ] && [ "$health" = "unhealthy" ]; then
        states[$n]="unhealthy"
        line="$line $n=unhealthy"
        bad="$bad $n"
      else
        states[$n]="$health"
        line="$line $n=$health"
        bad="$bad $n"
      fi
    done

    if [ -z "$bad" ]; then
      printf '  [%3ds]%s\n==> 全部 healthy：%s\n' "$elapsed" "$line" "$names"
      return 0
    fi

    if [ "$line" != "$prev" ] || [ $((elapsed - last_beat)) -ge 30 ]; then
      printf '  [%3ds]%s\n' "$elapsed" "$line"
      prev="$line"
      last_beat=$elapsed
    fi

    # 首次进入坏状态时喷一次日志，便于当场定位
    for n in $names; do
      local st="${states[$n]:-}"
      case "$st" in
        restarting*|exited*|unhealthy|missing)
          if [ -z "${dumped[$n]:-}" ]; then
            local cid
            cid=$(compose ps -q "$n" 2>/dev/null || true)
            echo "    ┌─ $n 处于 ${st}，最近 12 行日志："
            if [ -n "$cid" ]; then
              docker logs --tail 12 "$cid" 2>&1 | sed 's/^/    │ /' || true
            else
              echo "    │ (容器不存在)"
            fi
            echo "    └─"
            dumped[$n]=1
          fi
          ;;
      esac
    done

    if [ "$elapsed" -ge "$timeout" ]; then
      echo "==> 超时 ${elapsed}s，未就绪：$bad" >&2
      for n in $bad; do
        local cid
        cid=$(compose ps -q "$n" 2>/dev/null || true)
        echo "──── $n 最后 30 行 ────" >&2
        if [ -n "$cid" ]; then
          docker logs --tail 30 "$cid" 2>&1 | sed 's/^/  /' >&2 || true
        else
          echo "  (容器不存在)" >&2
        fi
      done
      compose ps >&2
      return 1
    fi

    sleep "$POLL"
  done
}

echo "==> git pull"
git -C "$REPO" fetch -q origin
git -C "$REPO" reset -q --hard origin/main
git -C "$REPO" log --oneline -1

CORE="mysql redis nacos rmq-namesrv rmq-broker"
APP="gateway user-service community-service content-service interaction-service notification-service search-service rank-service"

case "$TARGET" in
  core)
    echo "==> 启动 core"
    compose --profile core up -d
    wait_healthy $CORE
    ;;
  app)
    echo "==> 构建并启动 app"
    compose --profile app up -d --build
    wait_healthy $APP
    ;;
  all)
    echo "==> 启动 core"
    compose --profile core up -d
    wait_healthy $CORE
    echo "==> 构建并启动 app"
    compose --profile app up -d --build
    wait_healthy $APP
    ;;
  *)
    echo "==> 重建单个服务：$TARGET"
    compose --profile app up -d --build "$TARGET"
    wait_healthy "$TARGET"
    ;;
esac

echo
compose ps
