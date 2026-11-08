#!/usr/bin/env bash
# 把仓库中的 nginx 配置安装到宿主机并平滑重载。
# 幂等：重复执行安全。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/kuaikan.conf"
DST=/etc/nginx/sites-available/kuaikan

[ "$(id -u)" -eq 0 ] || { echo "需要 root"; exit 1; }

install -m 0644 "$SRC" "$DST"
ln -sf "$DST" /etc/nginx/sites-enabled/kuaikan
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
echo "nginx 配置已更新并重载"
