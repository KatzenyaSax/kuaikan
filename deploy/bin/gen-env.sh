#!/usr/bin/env bash
# 生成 / 补全服务器上的环境变量文件。幂等：已存在的变量不覆盖，只追加缺失的。
#
#   /opt/kuaikan/env/kuaikan.env   权限 600，不进 git
set -euo pipefail

ENV_DIR="${ENV_DIR:-/opt/kuaikan/env}"
ENV_FILE="$ENV_DIR/kuaikan.env"

mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}"; }
genb64() { openssl rand -base64 "${1:-32}" | tr -d '\n'; }

# key=需要的生成器
WANTED=(
  "MYSQL_ROOT_PASSWORD=gen 32"
  "MYSQL_PWD_USER=gen 24"
  "MYSQL_PWD_COMMUNITY=gen 24"
  "MYSQL_PWD_CONTENT=gen 24"
  "MYSQL_PWD_INTERACTION=gen 24"
  "MYSQL_PWD_NOTIFICATION=gen 24"
  "REDIS_PASSWORD=gen 32"
  "NACOS_AUTH_TOKEN=genb64 32"
  "NACOS_AUTH_IDENTITY_KEY=gen 16"
  "NACOS_AUTH_IDENTITY_VALUE=gen 32"
  "APP_TAG=literal dev"
)

[ -f "$ENV_FILE" ] || { umask 077; echo "# 由 deploy/bin/gen-env.sh 生成于 $(date -Is)" > "$ENV_FILE"; }

added=0
for item in "${WANTED[@]}"; do
  key="${item%%=*}"
  spec="${item#*=}"
  if grep -qE "^[[:space:]]*${key}=" "$ENV_FILE"; then
    continue
  fi
  case "$spec" in
    "gen "*)    value=$(${spec}) ;;
    "genb64 "*) value=$(genb64 "${spec#genb64 }") ;;
    "literal "*) value="${spec#literal }" ;;
    *) value="$spec" ;;
  esac
  echo "${key}=${value}" >> "$ENV_FILE"
  echo "  + ${key}"
  added=$((added + 1))
done

chmod 600 "$ENV_FILE"
if [ "$added" -eq 0 ]; then
  echo "已是最新，未改动：$ENV_FILE"
else
  echo "已追加 $added 个变量：$ENV_FILE"
fi
