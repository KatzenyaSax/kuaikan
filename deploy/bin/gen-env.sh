#!/usr/bin/env bash
# 生成服务器上的环境变量文件（含随机密码）。幂等：已存在则不覆盖。
#
#   /opt/kuaikan/env/kuaikan.env   权限 600，不进 git
set -euo pipefail

ENV_DIR="${ENV_DIR:-/opt/kuaikan/env}"
ENV_FILE="$ENV_DIR/kuaikan.env"

if [ -f "$ENV_FILE" ]; then
  echo "已存在，未改动：$ENV_FILE"
  exit 0
fi

mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}"; }

umask 077
cat > "$ENV_FILE" <<EOF
# 由 deploy/bin/gen-env.sh 生成于 $(date -Is)
MYSQL_ROOT_PASSWORD=$(gen 32)
MYSQL_PWD_USER=$(gen 24)
MYSQL_PWD_COMMUNITY=$(gen 24)
MYSQL_PWD_CONTENT=$(gen 24)
MYSQL_PWD_INTERACTION=$(gen 24)
MYSQL_PWD_NOTIFICATION=$(gen 24)
REDIS_PASSWORD=$(gen 32)
APP_TAG=dev
EOF
chmod 600 "$ENV_FILE"
echo "已生成：$ENV_FILE"
