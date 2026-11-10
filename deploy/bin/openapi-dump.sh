#!/usr/bin/env bash
# 采集 7 个服务的 OpenAPI 契约到 web/openapi/。
#
#   ./deploy/bin/openapi-dump.sh
#
# 脚本会自动判断运行位置：
#   - 在服务器上（有 docker 且 $REPO/services 存在）→ 直接 docker exec 拉取
#   - 在开发机上 → 通过 SSH 到服务器执行 docker exec
#
# 产物需要提交进仓库：这样「后端契约」与「前端生成类型」的漂移
# 可以被 `git diff` 发现，而不是等运行时才炸。
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
OUT_DIR="$APP_DIR/web/openapi"

SERVICES="user-service:8081 community-service:8082 content-service:8083 interaction-service:8084 notification-service:8085 search-service:8086 rank-service:8087"

SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

MODE=""
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^kuaikan-user-service-1$'; then
  MODE="local-docker"
elif command -v ssh >/dev/null 2>&1 && [ -f "$SSH_KEY" ]; then
  MODE="ssh"
else
  echo "既没有可用的 docker（本机），也没有 ${SSH_KEY}（远程），无法采集" >&2
  exit 1
fi

echo "==> 采集模式：$MODE"
echo "==> 输出目录：$OUT_DIR"
mkdir -p "$OUT_DIR"

fail=0
for pair in $SERVICES; do
  svc=${pair%%:*}
  port=${pair##*:}
  out="$OUT_DIR/${svc}.json"

  if [ "$MODE" = "local-docker" ]; then
    body=$(docker exec "kuaikan-${svc}-1" curl -fsS "http://127.0.0.1:${port}/internal/api-docs" 2>/dev/null || true)
  else
    body=$(ssh "${SSH_OPTS[@]}" "$SSH_HOST" \
      "docker exec kuaikan-${svc}-1 curl -fsS http://127.0.0.1:${port}/internal/api-docs" 2>/dev/null || true)
  fi

  if [ -z "$body" ]; then
    echo "  ✗ $svc 拉取失败" >&2
    fail=1
    continue
  fi

  printf '%s' "$body" > "$out"

  # 校验是有效 JSON 且含 openapi 字段
  if command -v python3 >/dev/null 2>&1; then
    ok=$(python3 - "$out" <<'EOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("invalid")
    raise SystemExit(0)
print(f"{d.get('openapi', '?')}  {len(d.get('paths', {}))} paths")
EOF
)
  else
    ok="(未校验)"
  fi

  if printf '%s' "$ok" | grep -q invalid; then
    echo "  ✗ $svc 返回的不是有效 spec" >&2
    fail=1
  else
    printf '  %-22s %s\n' "$svc" "$ok"
  fi
done

echo
if [ $fail -ne 0 ]; then
  echo "有服务采集失败" >&2
  exit 1
fi
echo "完成。请检查 git diff 后提交 web/openapi/"
