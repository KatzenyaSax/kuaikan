#!/usr/bin/env bash
# 把 P0 冒烟控制台发布到 nginx 静态目录。
#
# 这是临时探活页，不是产品前端 —— 后续会被真正的 React 应用构建产物替换。
#   ./deploy/bin/install-status.sh
set -euo pipefail

REPO="${REPO:-/opt/kuaikan/repo}"
DEST="${DEST:-/opt/kuaikan/frontend/dist}"

[ -f "$REPO/deploy/status/index.html" ] || { echo "缺少 $REPO/deploy/status/index.html" >&2; exit 1; }

mkdir -p "$DEST"
install -m 0644 "$REPO/deploy/status/index.html" "$DEST/index.html"
echo "已发布：$DEST/index.html"
echo "访问：https://www.katzenyasax.top/"
