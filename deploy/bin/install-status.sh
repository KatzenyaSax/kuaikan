#!/usr/bin/env bash
# 发布静态页面到 nginx 目录。
#
#   /opt/kuaikan/frontend/dist/index.html       根路径占位页（将来被 React 构建产物替换）
#   /opt/kuaikan/frontend/test/index.html       P0 冒烟控制台，长期维护，访问 /test/
#
#   ./deploy/bin/install-status.sh
set -euo pipefail

REPO="${REPO:-/opt/kuaikan/repo}"
DEST="${DEST:-/opt/kuaikan/frontend}"
FORCE="${FORCE:-0}"   # FORCE=1 时强制覆盖根路径

SRC_ROOT="$REPO/deploy/status/root/index.html"
SRC_TEST="$REPO/deploy/status/test/index.html"

[ -f "$SRC_ROOT" ] || { echo "缺少 $SRC_ROOT" >&2; exit 1; }
[ -f "$SRC_TEST" ] || { echo "缺少 $SRC_TEST" >&2; exit 1; }

mkdir -p "$DEST/dist" "$DEST/test"

# 根路径占位页：不覆盖已存在的真实前端产物（用 FORCE=1 强制覆盖）
if [ "$FORCE" != "1" ] && [ -f "$DEST/dist/index.html" ] && ! grep -q "前端尚未构建" "$DEST/dist/index.html" 2>/dev/null; then
  echo "跳过根路径：$DEST/dist/index.html 已存在且不是占位页（可能是真实前端构建产物）"
else
  install -m 0644 "$SRC_ROOT" "$DEST/dist/index.html"
  echo "已发布根占位页：$DEST/dist/index.html"
fi

install -m 0644 "$SRC_TEST" "$DEST/test/index.html"
echo "已发布冒烟控制台：$DEST/test/index.html"

echo
echo "  https://www.katzenyasax.top/        （占位）"
echo "  https://www.katzenyasax.top/test/   （冒烟控制台）"
