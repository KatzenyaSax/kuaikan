#!/usr/bin/env bash
# 构建并发布前端到线上，替换根路径；**绝不触碰 /test/**。
#
#   ./deploy/bin/deploy-web.sh
#
# 设计要点：
#   1. 先在本地产出并校验（typecheck + build），构建失败绝不发到线上。
#   2. 传输用 tar over ssh 而不是 rsync：避免 macOS 自带的 openrsync 与 GNU rsync
#      参数差异，行为更确定。
#   3. 解包到 dist.new 再原子换名，避免"解到一半失败"导致站点变成半截。
#   4. 只操作 /opt/kuaikan/frontend/dist，test/ 是它的兄弟目录，物理上不可能被覆盖。
#   5. 发布后立刻做一次线上冒烟（L4/L5/L6a），失败即非零退出。
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"
REMOTE_DIR="${REMOTE_DIR:-/opt/kuaikan/frontend}"

SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

SITE="${SITE:-https://www.katzenyasax.top}"

if ! command -v node >/dev/null 2>&1; then
  echo "本地没有 node，本脚本必须在开发机上运行（构建与发布分离，见 ADR 0007）" >&2
  exit 1
fi

echo "==> 1/4 本地校验与构建"
cd "$WEB_DIR"
npm run typecheck
npm run build

JS=$(find dist/assets -name '*.js' -maxdepth 1 | head -1)
[ -n "$JS" ] || { echo "构建产物里没有 js" >&2; exit 1; }
echo "    产物：$(du -h "$JS" | cut -f1) $(du -h dist/assets/*.css | cut -f1 | head -1) css"

echo
echo "==> 2/4 传输到 $SSH_HOST:$REMOTE_DIR/dist"
# COPYFILE_DISABLE=1：阻止 macOS 的 tar 写入 AppleDouble(._*) 文件与 xattr 头。
# 不加的话远端会多出 5 个 ._ 垃圾文件，虽然不影响访问，但很脏。
COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C dist . | ssh "${SSH_OPTS[@]}" "$SSH_HOST" "
  set -e
  rm -rf '$REMOTE_DIR/dist.new'
  mkdir -p '$REMOTE_DIR/dist.new'
  tar -xzf - -C '$REMOTE_DIR/dist.new'
  rm -rf '$REMOTE_DIR/dist.old'
  if [ -d '$REMOTE_DIR/dist' ]; then mv '$REMOTE_DIR/dist' '$REMOTE_DIR/dist.old'; fi
  mv '$REMOTE_DIR/dist.new' '$REMOTE_DIR/dist'
  rm -rf '$REMOTE_DIR/dist.old'
  echo '    远端文件数：'\$(find '$REMOTE_DIR/dist' -type f | wc -l)
"

echo
echo "==> 3/4 线上冒烟"
sleep 1
html=$(curl -fsS --max-time 15 "$SITE/")
if printf '%s' "$html" | grep -q '前端尚未构建'; then
  echo "    线上仍是占位页" >&2; exit 1
fi
if ! printf '%s' "$html" | grep -q '<script type="module"'; then
  echo "    线上首页里没有 module script，可能不是 Vite 产物" >&2; exit 1
fi
asset=$(printf '%s' "$html" | grep -o '/assets/[^"]*\.js' | head -1)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE$asset")
echo "    首页 OK，静态资源 $asset -> $code"
[ "$code" = "200" ] || { echo "    静态资源不可达" >&2; exit 1; }

# /test/ 必须仍然存在
tcode=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/test/")
echo "    /test/ -> $tcode"
[ "$tcode" = "200" ] || { echo "    /test/ 被破坏了" >&2; exit 1; }

echo
echo "==> 4/4 完成"
echo "    $SITE/"
echo "    $SITE/test/"
