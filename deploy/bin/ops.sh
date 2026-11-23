#!/usr/bin/env bash
# kuaikan 云端运维与调试统一入口（在开发机执行，通过 SSH 复用连接操作云端）。
#
#   ./deploy/bin/ops.sh status                  总览：系统/内存/磁盘/nginx/容器状态
#   ./deploy/bin/ops.sh disk                    磁盘与 Docker 空间排查
#   ./deploy/bin/ops.sh ps                      compose 容器列表
#   ./deploy/bin/ops.sh top                     各容器实时 CPU / 内存占用
#   ./deploy/bin/ops.sh logs <svc> [args...]    查看服务日志（默认 --tail 100，支持 -f）
#   ./deploy/bin/ops.sh restart <svc...>        重启一个或多个服务
#   ./deploy/bin/ops.sh up <target>             远程 git pull + 构建 + 启动 + 等健康
#   ./deploy/bin/ops.sh check [module]          远程仅编译检查（不建镜像）
#   ./deploy/bin/ops.sh compose <args...>       透传 docker compose（自动带 env 和 profiles）
#   ./deploy/bin/ops.sh exec <svc> <cmd...>     在容器内执行命令
#   ./deploy/bin/ops.sh mysql ...               MySQL 查询/库表/进程（自动认证）
#   ./deploy/bin/ops.sh redis ...               Redis 状态/SCAN/cli（自动认证）
#   ./deploy/bin/ops.sh nginx ...               宿主机 Nginx 状态/校验/重载/配置/日志
#   ./deploy/bin/ops.sh nacos                   Nacos 已注册服务与健康实例数
#   ./deploy/bin/ops.sh rmq ...                 RocketMQ topics/cluster/consumer/init
#   ./deploy/bin/ops.sh sh <cmd...>             在云端执行任意命令
#   ./deploy/bin/ops.sh conn [status|close]     查看或关闭 SSH 复用长连接
#
# 服务简称映射：gw→gateway、user→user-service、community→community-service、
# content→content-service、interaction→interaction-service、notification→notification-service、
# search→search-service、rank→rank-service、rmq→rmq-broker、namesrv→rmq-namesrv、es→elasticsearch。
set -euo pipefail

SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
REMOTE_REPO="${REMOTE_REPO:-/opt/kuaikan/repo}"
REMOTE_ENV="${REMOTE_ENV:-/opt/kuaikan/env/kuaikan.env}"
REMOTE_COMPOSE="${REMOTE_REPO}/deploy/compose/compose.yml"
OPS_MUX="${OPS_MUX:-1}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-/tmp/kk-ssh-%C}"

REMOTE_COMPOSE_CMD="docker compose --env-file ${REMOTE_ENV} -f ${REMOTE_COMPOSE} --profile core --profile app --profile devtools"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=accept-new
)
if [ "$OPS_MUX" = "1" ]; then
  SSH_OPTS+=(
    -o ControlMaster=auto
    -o ControlPersist=10m
    -o "ControlPath=${SSH_CONTROL_PATH}"
  )
fi

usage() {
  cat <<'EOF'
kuaikan 云端运维工具（./deploy/bin/ops.sh）

总览与巡检：
  status                          系统负载、内存、磁盘、Nginx、全部容器状态与重启次数
  disk                            根目录、Docker 空间、/opt/kuaikan 与 /var/log 占用排查
  ps                              docker compose ps -a
  top                             docker stats --no-stream（按内存降序）

容器与发布（支持简称：gw/user/community/content/interaction/notification/search/rank/rmq/namesrv/es）：
  logs <svc> [args...]            查看日志（默认 --tail 100；支持 -f、--tail N、--since 10m）
  restart <svc...>                重启一个或多个服务
  up <target>                     远程执行 deploy/bin/up.sh（core / app / all / 单服务）
  check [module]                  远程执行 deploy/bin/check.sh（仅快速编译，不建镜像）
  compose <args...>               透传 docker compose（自动带 env-file 与全部 profile）
  exec <svc> <cmd...>             在目标容器内执行命令

MySQL（容器内自动读取 MYSQL_ROOT_PASSWORD，不暴露密码）：
  mysql dbs                       查看所有数据库及占用大小
  mysql tables <db>               查看指定库的所有表、估算行数与大小
  mysql desc <db> <table>         查看表结构与建表语句
  mysql process                   查看当前连接与查询（SHOW FULL PROCESSLIST）
  mysql query [db] <sql|->        执行 SQL（传 "-" 表示从 stdin 读取多行 SQL）

Redis（容器内自动读取 REDIS_PASSWORD，不暴露密码）：
  redis info [section]            查看核心指标摘要（传 section 如 memory/clients/keyspace 看详情）
  redis keys [pattern=*] [limit]  用非阻塞 SCAN 扫描 key（默认上限 100，绝不用 KEYS）
  redis cli <args...>             透传 redis-cli 命令（如 redis cli DBSIZE）

Nginx（宿主机）：
  nginx status                    运行状态、配置校验、监听端口
  nginx test                      执行 nginx -t
  nginx reload                    先 nginx -t 通过后再平滑 reload
  nginx conf                      查看线上生效配置（/etc/nginx/sites-enabled/kuaikan）
  nginx access [lines=50]         查看最新 access.log（支持加 -f）
  nginx error [lines=50]          查看最新 error.log（支持加 -f）
  nginx install                   远程执行 deploy/nginx/install.sh 同步配置并 reload

Nacos & RocketMQ：
  nacos                           查看 Nacos 注册服务及健康实例数
  rmq topics                      列出 RocketMQ topics
  rmq cluster                     查看 RocketMQ 集群与 Broker 状态
  rmq consumer <group>            查看指定消费组的消费进度与积压
  rmq init                        远程执行 deploy/bin/init-topics.sh（幂等建 topic）

其他：
  sh <cmd...>                     在云端执行任意 shell 命令
  conn [status|close]             查看或关闭 SSH ControlMaster 复用连接
EOF
}

die() {
  echo "✗ $*" >&2
  exit 1
}

resolve_service() {
  case "${1:-}" in
    gw|gateway)                 echo "gateway" ;;
    user|user-service)          echo "user-service" ;;
    community|community-service) echo "community-service" ;;
    content|content-service)    echo "content-service" ;;
    interaction|interaction-service) echo "interaction-service" ;;
    notification|notification-service) echo "notification-service" ;;
    search|search-service)      echo "search-service" ;;
    rank|rank-service)          echo "rank-service" ;;
    rmq|broker|rmq-broker)      echo "rmq-broker" ;;
    es|elasticsearch)           echo "elasticsearch" ;;
    namesrv|rmq-namesrv)        echo "rmq-namesrv" ;;
    *)                          echo "${1:-}" ;;
  esac
}

quote_args() {
  local out=""
  local arg
  for arg in "$@"; do
    out="${out}$(printf '%q' "$arg") "
  done
  printf '%s' "${out% }"
}

ssh_run() {
  ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$1"
}

ssh_run_stdin() {
  ssh "${SSH_OPTS[@]}" -T "$SSH_HOST" "$1"
}

cmd_status() {
  ssh_run '
    echo "=== 主机与负载 ==="
    uptime
    echo
    echo "=== 内存与交换分区 ==="
    free -h
    echo
    echo "=== 根目录磁盘 ==="
    df -h /
    echo
    echo "=== 宿主机 Nginx ==="
    printf "nginx: %s\n" "$(systemctl is-active nginx || true)"
    echo
    echo "=== Docker 容器 ==="
    docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" \
      | (IFS= read -r header; echo "$header"; sort)
    echo
    echo "=== 非零重启计数 ==="
    found=0
    while IFS=" " read -r cname cnt; do
      [ -n "$cname" ] || continue
      if [ "${cnt:-0}" -gt 0 ]; then
        printf "  %s: %s 次\n" "${cname#/}" "$cnt"
        found=1
      fi
    done < <(docker ps -aq | xargs -r docker inspect -f "{{.Name}} {{.RestartCount}}")
    if [ "$found" -eq 0 ]; then
      echo "  (无)"
    fi
  '
}

cmd_disk() {
  ssh_run '
    echo "=== 文件系统 ==="
    df -h /
    echo
    echo "=== Docker 占用 ==="
    docker system df
    echo
    echo "=== /opt/kuaikan 各目录 ==="
    du -sh /opt/kuaikan/* /opt/kuaikan/data/* 2>/dev/null | sort -hr || true
    echo
    echo "=== /var/log 占用 Top 10 ==="
    du -sh /var/log/* 2>/dev/null | sort -hr | head -n 10 || true
  '
}

cmd_ps() {
  ssh_run "${REMOTE_COMPOSE_CMD} ps -a"
}

cmd_top() {
  ssh_run '
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.PIDs}}" \
      | (IFS= read -r header; echo "$header"; sort -k4 -hr)
  '
}

cmd_logs() {
  [ $# -ge 1 ] || die "用法：ops.sh logs <service> [--tail N] [-f] [--since 10m]"
  local svc
  svc=$(resolve_service "$1")
  shift

  local has_tail=0
  local arg
  for arg in "$@"; do
    case "$arg" in
      --tail|--tail=*|-n|-n*) has_tail=1 ;;
    esac
  done

  local extra=""
  if [ "$has_tail" -eq 0 ]; then
    extra="--tail 100 "
  fi
  if [ $# -gt 0 ]; then
    extra="${extra}$(quote_args "$@")"
  fi

  ssh_run "${REMOTE_COMPOSE_CMD} logs ${extra} $(printf '%q' "$svc")"
}

cmd_restart() {
  [ $# -ge 1 ] || die "用法：ops.sh restart <service...>"
  local resolved=()
  local s
  for s in "$@"; do
    resolved+=("$(resolve_service "$s")")
  done
  local q
  q=$(quote_args "${resolved[@]}")
  ssh_run "${REMOTE_COMPOSE_CMD} restart ${q} && ${REMOTE_COMPOSE_CMD} ps ${q}"
}

cmd_up() {
  [ $# -ge 1 ] || die "用法：ops.sh up <core|app|all|service>"
  local target
  target=$(resolve_service "$1")
  ssh_run "${REMOTE_REPO}/deploy/bin/up.sh $(printf '%q' "$target")"
}

cmd_check() {
  if [ $# -ge 1 ]; then
    local mod
    mod=$(resolve_service "$1")
    ssh_run "${REMOTE_REPO}/deploy/bin/check.sh $(printf '%q' "$mod")"
  else
    ssh_run "${REMOTE_REPO}/deploy/bin/check.sh"
  fi
}

cmd_compose() {
  [ $# -ge 1 ] || die "用法：ops.sh compose <docker-compose args...>"
  ssh_run "${REMOTE_COMPOSE_CMD} $(quote_args "$@")"
}

cmd_exec() {
  [ $# -ge 2 ] || die "用法：ops.sh exec <service> <cmd...>"
  local svc
  svc=$(resolve_service "$1")
  shift
  local q_svc q_cmd
  q_svc=$(printf '%q' "$svc")
  q_cmd=$(quote_args "$@")
  ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q ${q_svc}); [ -n \"\$cid\" ] || { echo '找不到运行中容器：${svc}' >&2; exit 1; }; docker exec -i \"\$cid\" ${q_cmd}"
}

mysql_exec_sql() {
  local db="$1"
  local sql="$2"
  local db_flag=""
  if [ -n "$db" ]; then
    db_flag=" -D $(printf '%q' "$db")"
  fi
  printf '%s\n' "$sql" | ssh_run_stdin \
    "cid=\$(${REMOTE_COMPOSE_CMD} ps -q mysql); [ -n \"\$cid\" ] || { echo 'mysql 容器未运行' >&2; exit 1; }; docker exec -i \"\$cid\" sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysql -uroot --table${db_flag}'"
}

cmd_mysql() {
  [ $# -ge 1 ] || die "用法：ops.sh mysql <dbs|tables|desc|process|query> ..."
  local sub="$1"
  shift
  case "$sub" in
    dbs)
      mysql_exec_sql "" "
        SELECT
          s.SCHEMA_NAME AS db_name,
          COUNT(t.TABLE_NAME) AS tables,
          ROUND(COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) / 1024 / 1024, 2) AS size_mb
        FROM information_schema.SCHEMATA s
        LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        WHERE s.SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'sys')
        GROUP BY s.SCHEMA_NAME
        ORDER BY size_mb DESC, db_name ASC;
      "
      ;;
    tables)
      [ $# -ge 1 ] || die "用法：ops.sh mysql tables <db>"
      local db="$1"
      case "$db" in
        *[!A-Za-z0-9_-]*) die "非法库名：${db}" ;;
      esac
      mysql_exec_sql "" "
        SELECT
          TABLE_NAME AS table_name,
          TABLE_ROWS AS approx_rows,
          ROUND(DATA_LENGTH / 1024 / 1024, 2) AS data_mb,
          ROUND(INDEX_LENGTH / 1024 / 1024, 2) AS index_mb,
          ENGINE AS engine
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '${db}'
        ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC, TABLE_NAME ASC;
      "
      ;;
    desc)
      [ $# -ge 2 ] || die "用法：ops.sh mysql desc <db> <table>"
      local db="$1"
      local tbl="$2"
      case "$db" in *[!A-Za-z0-9_-]*) die "非法库名：${db}" ;; esac
      case "$tbl" in *[!A-Za-z0-9_-]*) die "非法表名：${tbl}" ;; esac
      mysql_exec_sql "$db" "DESCRIBE \`${tbl}\`; SHOW CREATE TABLE \`${tbl}\`\G"
      ;;
    process)
      mysql_exec_sql "" "SHOW FULL PROCESSLIST;"
      ;;
    query)
      local db="" sql=""
      if [ $# -eq 1 ]; then
        sql="$1"
      elif [ $# -ge 2 ]; then
        db="$1"
        shift
        sql="$*"
      else
        die "用法：ops.sh mysql query [db] <sql|->"
      fi
      if [ "$sql" = "-" ]; then
        local db_flag=""
        if [ -n "$db" ]; then
          db_flag=" -D $(printf '%q' "$db")"
        fi
        ssh_run_stdin \
          "cid=\$(${REMOTE_COMPOSE_CMD} ps -q mysql); [ -n \"\$cid\" ] || { echo 'mysql 容器未运行' >&2; exit 1; }; docker exec -i \"\$cid\" sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysql -uroot --table${db_flag}'"
      else
        mysql_exec_sql "$db" "$sql"
      fi
      ;;
    *)
      die "未知 mysql 子命令：${sub}（支持 dbs / tables / desc / process / query）"
      ;;
  esac
}

cmd_redis() {
  [ $# -ge 1 ] || die "用法：ops.sh redis <info|keys|cli> ..."
  local sub="$1"
  shift
  case "$sub" in
    info)
      if [ $# -ge 1 ]; then
        local sec
        sec=$(printf '%q' "$1")
        ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q redis); [ -n \"\$cid\" ] || { echo 'redis 容器未运行' >&2; exit 1; }; docker exec -i \"\$cid\" sh -c 'REDISCLI_AUTH=\"\$REDIS_PASSWORD\" exec redis-cli INFO ${sec}'"
      else
        ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q redis); [ -n \"\$cid\" ] || { echo 'redis 容器未运行' >&2; exit 1; }; docker exec -i \"\$cid\" sh -c 'REDISCLI_AUTH=\"\$REDIS_PASSWORD\" redis-cli INFO' | grep -E '^(# |redis_version:|uptime_in_days:|connected_clients:|used_memory_human:|used_memory_peak_human:|maxmemory_human:|mem_fragmentation_ratio:|total_commands_processed:|keyspace_hits:|keyspace_misses:|db[0-9]+:)'"
      fi
      ;;
    keys)
      local pattern="${1:-*}"
      local limit="${2:-100}"
      case "$limit" in *[!0-9]*) die "limit 必须是正整数：${limit}" ;; esac
      local q_pat
      q_pat=$(printf '%q' "$pattern")
      ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q redis); [ -n \"\$cid\" ] || { echo 'redis 容器未运行' >&2; exit 1; }; docker exec -i \"\$cid\" sh -c 'REDISCLI_AUTH=\"\$REDIS_PASSWORD\" exec redis-cli --scan --pattern \"\$1\"' -- ${q_pat} | head -n ${limit}"
      ;;
    cli)
      [ $# -ge 1 ] || die "用法：ops.sh redis cli <redis-cli args...>"
      local q_args
      q_args=$(quote_args "$@")
      ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q redis); [ -n \"\$cid\" ] || { echo 'redis 容器未运行' >&2; exit 1; }; docker exec -i \"\$cid\" sh -c 'REDISCLI_AUTH=\"\$REDIS_PASSWORD\" exec redis-cli \"\$@\"' -- ${q_args}"
      ;;
    *)
      die "未知 redis 子命令：${sub}（支持 info / keys / cli）"
      ;;
  esac
}

cmd_nginx() {
  [ $# -ge 1 ] || die "用法：ops.sh nginx <status|test|reload|conf|access|error|install>"
  local sub="$1"
  shift
  case "$sub" in
    status)
      ssh_run '
        echo "=== systemd ==="
        systemctl status nginx --no-pager -n 10 || true
        echo
        echo "=== nginx -t ==="
        nginx -t
        echo
        echo "=== 监听端口 ==="
        ss -tlnp | grep nginx || true
      '
      ;;
    test)
      ssh_run "nginx -t"
      ;;
    reload)
      ssh_run "nginx -t && systemctl reload nginx && echo 'nginx 已校验并平滑重载'"
      ;;
    conf)
      ssh_run "cat /etc/nginx/sites-enabled/kuaikan"
      ;;
    access|error)
      local logfile="/var/log/nginx/${sub}.log"
      local lines="50"
      local follow=0
      local arg
      for arg in "$@"; do
        if [ "$arg" = "-f" ]; then
          follow=1
        else
          case "$arg" in
            *[!0-9]*) die "日志行数必须是数字：${arg}" ;;
            *) lines="$arg" ;;
          esac
        fi
      done
      if [ "$follow" -eq 1 ]; then
        ssh_run "tail -n ${lines} -f ${logfile}"
      else
        ssh_run "tail -n ${lines} ${logfile}"
      fi
      ;;
    install)
      ssh_run "${REMOTE_REPO}/deploy/nginx/install.sh"
      ;;
    *)
      die "未知 nginx 子命令：${sub}（支持 status / test / reload / conf / access / error / install）"
      ;;
  esac
}

cmd_nacos() {
  ssh_run '
    cid=$('"${REMOTE_COMPOSE_CMD}"' ps -q nacos)
    [ -n "$cid" ] || { echo "nacos 容器未运行" >&2; exit 1; }
    docker exec -i "$cid" sh -c '\''
      json=$(curl -fsS "http://127.0.0.1:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=100")
      echo "服务列表：${json}"
    '\''
    echo
    echo "=== 各服务实例健康状态 ==="
    docker exec -i "$cid" sh -c '\''
      svcs=$(curl -fsS "http://127.0.0.1:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=100" \
        | sed -n "s/.*\"doms\":\[\([^]]*\)\].*/\1/p" | tr -d "\"" | tr "," "\n")
      for s in $svcs; do
        [ -n "$s" ] || continue
        inst=$(curl -fsS "http://127.0.0.1:8848/nacos/v1/ns/instance/list?serviceName=${s}" 2>/dev/null || true)
        healthy=$(printf "%s" "$inst" | grep -o "\"healthy\":true" | wc -l | tr -d " ")
        total=$(printf "%s" "$inst" | grep -o "\"healthy\":" | wc -l | tr -d " ")
        printf "  %-28s healthy=%s/%s\n" "$s" "$healthy" "$total"
      done
    '\''
  '
}

cmd_rmq() {
  [ $# -ge 1 ] || die "用法：ops.sh rmq <topics|cluster|consumer|init>"
  local sub="$1"
  shift
  local mq_bin="/home/rocketmq/rocketmq-5.3.4/bin/mqadmin"
  local namesrv="rmq-namesrv:9876"
  case "$sub" in
    topics)
      ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q rmq-broker); [ -n \"\$cid\" ] || { echo 'rmq-broker 未运行' >&2; exit 1; }; docker exec \"\$cid\" sh ${mq_bin} topicList -n ${namesrv} 2>/dev/null | grep -E '^(kuaikan_|%RETRY%|%DLQ%)' || docker exec \"\$cid\" sh ${mq_bin} topicList -n ${namesrv} 2>/dev/null"
      ;;
    cluster)
      ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q rmq-broker); [ -n \"\$cid\" ] || { echo 'rmq-broker 未运行' >&2; exit 1; }; docker exec \"\$cid\" sh ${mq_bin} clusterList -n ${namesrv} 2>/dev/null"
      ;;
    consumer)
      [ $# -ge 1 ] || die "用法：ops.sh rmq consumer <group>"
      local grp
      grp=$(printf '%q' "$1")
      ssh_run "cid=\$(${REMOTE_COMPOSE_CMD} ps -q rmq-broker); [ -n \"\$cid\" ] || { echo 'rmq-broker 未运行' >&2; exit 1; }; docker exec \"\$cid\" sh ${mq_bin} consumerProgress -n ${namesrv} -g ${grp} 2>/dev/null"
      ;;
    init)
      ssh_run "${REMOTE_REPO}/deploy/bin/init-topics.sh"
      ;;
    *)
      die "未知 rmq 子命令：${sub}（支持 topics / cluster / consumer / init）"
      ;;
  esac
}

cmd_sh() {
  [ $# -ge 1 ] || die "用法：ops.sh sh <command>"
  ssh_run "$*"
}

cmd_conn() {
  local sub="${1:-status}"
  case "$sub" in
    status)
      ssh "${SSH_OPTS[@]}" -O check "$SSH_HOST" 2>&1 || true
      ;;
    close)
      ssh "${SSH_OPTS[@]}" -O exit "$SSH_HOST" 2>&1 || true
      ;;
    *)
      die "用法：ops.sh conn [status|close]"
      ;;
  esac
}

main() {
  if [ $# -eq 0 ]; then
    usage
    exit 0
  fi
  local cmd="$1"
  shift
  case "$cmd" in
    -h|--help|help) usage ;;
    status)   cmd_status "$@" ;;
    disk)     cmd_disk "$@" ;;
    ps)       cmd_ps "$@" ;;
    top)      cmd_top "$@" ;;
    logs)     cmd_logs "$@" ;;
    restart)  cmd_restart "$@" ;;
    up)       cmd_up "$@" ;;
    check)    cmd_check "$@" ;;
    compose)  cmd_compose "$@" ;;
    exec)     cmd_exec "$@" ;;
    mysql)    cmd_mysql "$@" ;;
    redis)    cmd_redis "$@" ;;
    nginx)    cmd_nginx "$@" ;;
    nacos)    cmd_nacos "$@" ;;
    rmq)      cmd_rmq "$@" ;;
    sh)       cmd_sh "$@" ;;
    conn)     cmd_conn "$@" ;;
    *)        die "未知子命令：${cmd}（运行 ops.sh help 查看全部用法）" ;;
  esac
}

main "$@"
