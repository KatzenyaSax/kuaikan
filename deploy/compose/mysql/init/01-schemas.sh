#!/bin/bash
# MySQL 首次初始化时执行（仅在 datadir 为空时运行一次）。
#
# 目的：按 ADR 0006 为每个服务建独立 schema，并建只对该 schema 有权限的账号。
# 「库权限必须在建库脚本里配死，靠自觉是守不住的」—— 这里就是那个脚本。
#
# 密码来自 compose 注入的环境变量，不落仓库。
set -euo pipefail

mysql_init() {
  local db="$1" user="$2" pwd="$3"
  mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${db}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${pwd}';
ALTER USER '${user}'@'%' IDENTIFIED BY '${pwd}';
GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${user}'@'%';
SQL
  echo "[init] schema=${db} user=${user}"
}

mysql_init kuaikan_user         u_user         "${MYSQL_PWD_USER}"
mysql_init kuaikan_community    u_community    "${MYSQL_PWD_COMMUNITY}"
mysql_init kuaikan_content      u_content      "${MYSQL_PWD_CONTENT}"
mysql_init kuaikan_interaction  u_interaction  "${MYSQL_PWD_INTERACTION}"
mysql_init kuaikan_notification u_notification "${MYSQL_PWD_NOTIFICATION}"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "FLUSH PRIVILEGES;"
echo "[init] 各服务 schema 与受限账号就绪"
