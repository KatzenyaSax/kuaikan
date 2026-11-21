#!/usr/bin/env bash
# P5.5 社交关系与个人中心验收。
#
#   ./deploy/bin/verify-p55.sh             全量（L0 → L4）
#   ./deploy/bin/verify-p55.sh --layer l2  只跑某一层
#   ./deploy/bin/verify-p55.sh --fast      跳过浏览器层（L3）
#
# 分层：
#   L0 静态与契约   check-contract / check-openapi / check-scripts / typecheck / lint / build
#                   + 工作区干净（只在全量时检查：单独跑 --layer 时工作区本来就可能脏）
#   L1 基础设施     云端容器 healthy、P5.5 三处迁移与索引、FOLLOW topic 与消费组
#   L2 后端 HTTP    关注幂等 / 自关注 / 不存在 / 游客白名单与鉴权边界 / 互关 /
#                   24h 冷却去重 / 单作者与多作者帖子分页与跨游标拒绝 /
#                   用户社群 / 我的收藏 / 批量摘要剔除已删帖 / 改密全端失效
#   L3 浏览器       e2e-p55.mjs（游客四 Tab、关注链路、关注消息、/me 收藏、改密）
#   L4 清理核验     trap cleanup 彻底清理，并验证线上首页无 e2e 残留
#
# **不递归调用 verify-p3.sh 或任何其他 verify 脚本**：
# P5.5 的回归由 verify-p3.sh 的 L5 覆盖，这里再递归一次等于整套验收跑两遍。
# 本阶段也没有破坏性动作：L4 只清理自己造的测试数据，不停容器、不动线上。
#
# 断言纪律（P4/P5 踩出来的）：
#   每个「应该不产生」的断言，前面必须先有「产生路径确实通」的断言。
#   24h 冷却那条尤其如此：先证明第一条 FOLLOW 消息真的落库了，
#   「取关再关注没有第二条」才有意义。
#
# 各层**各用一套夹具**：L2 改密码会把账号的密码换掉，
# L3 的浏览器流程也要改密码——共用一套夹具时后跑的层必然踩前一层的残留
# （P4.4 与 P5 的「单层跑过、全量跑红」都是这个原因）。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"
COMPOSE_ARGS=(-f /opt/kuaikan/repo/deploy/compose/compose.yml --profile core --profile app)
MQ_BIN="${MQ_BIN:-/home/rocketmq/rocketmq-5.3.4/bin/mqadmin}"
MQ_NAMESRV="${MQ_NAMESRV:-rmq-namesrv:9876}"

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=""; R=""; Y=""; D=""; B=""; N=""
fi

PASS=0; FAIL=0; SKIP=0
declare -a FAILED=()
section() { printf '\n%s%s%s\n' "$B" "$1" "$N"; }
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
ng()   { FAIL=$((FAIL+1)); FAILED+=("$1"); printf '  %s✗%s %s%s%s\n' "$R" "$N" "$1" "${2:+ — $2}" ""; }
skip() { SKIP=$((SKIP+1)); printf '  %s-%s %s（%s）\n' "$Y" "$N" "$1" "${2:-跳过}"; }
info() { printf '  %s%s%s\n' "$D" "$1" "$N"; }

ssh_run() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@" 2>/dev/null; }

ONLY_LAYER_NORM=$(printf '%s' "$ONLY_LAYER" | tr '[:upper:]' '[:lower:]')
want_layer() {
  [ -z "$ONLY_LAYER_NORM" ] && return 0
  [ "$ONLY_LAYER_NORM" = "$1" ] && return 0
  return 1
}
want_browser_layer() {
  [ "$FAST" = "1" ] && return 1
  want_layer l3
}

printf '%s%s%s\n' "$B" "kuaikan · P5.5 验收" "$N"
info "站点 $SITE"
info "开始 $(date '+%F %T')"

json_field() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
v=d
for k in sys.argv[1].split('.'):
    if isinstance(v,dict) and k in v: v=v[k]
    elif isinstance(v,list) and k.isdigit() and int(k) < len(v): v=v[int(k)]
    else: print(''); raise SystemExit(0)
print('' if v is None else v)
" "$1" 2>/dev/null; }

sql_exec() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p55-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p55-fixture.sql 2>/dev/null
    rm -f /tmp/p55-fixture.sql"
}

# 保留 stderr 的版本：只给清理用。sql_exec 把 stderr 吞掉，
# 多表 DELETE 的 `No database selected` 会变成静默失败。
sql_exec_v() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p55-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p55-fixture.sql 2>&1
    rm -f /tmp/p55-fixture.sql"
}

# 在 redis 容器里跑一段 shell 脚本。
# 脚本必须 `sh -s` 从 stdin 喂进去：写成 `docker exec ... sh /tmp/x.sh`
# 会去**容器里**找 /tmp，那里没有这个文件（宿主机的 /tmp 不共享）。
redis_exec() {
  local b64
  b64=$(printf '%s\n' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p55-redis.sh
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-redis-1 sh -s < /tmp/p55-redis.sh
    rm -f /tmp/p55-redis.sh"
}

redis_eval() {
  redis_exec "redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" $1"
}

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-20}" "$1" 2>/dev/null || echo "000"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

# ---------------------------------------------------------------- 夹具工具

# 密码 E2eFixture-Passw0rd 的 BCrypt 哈希（cost 10，与线上一致）。
# 这是**测试夹具**不是密钥：哈希对应固定测试密码，账号每次运行都不同且结束即删。
FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
FIXTURE_NEW_PASS='E2eFixture-NewPassw0rd'
STAMP="$(date +%s)"
CLEANUP_NEEDED=0
P55_IDS=""

mk_user() {  # $1=email $2=nickname → 输出 id
  sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$1', '$FIXTURE_HASH', '$2', 'USER', 1);
    SELECT id FROM kuaikan_user.t_user WHERE email='$1';" | sed -n '1p' | tr -d '\r\n '
}

login_token() {  # $1=email $2=password → accessToken
  curl -s --max-time 20 -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | json_field 'data.accessToken'
}

login_token_jar() {  # $1=email $2=password $3=cookiejar → accessToken
  curl -s -c "$3" --max-time 20 -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | json_field 'data.accessToken'
}

create_community() {  # $1=token $2=name → id
  curl -s --max-time 20 -X POST "$SITE/api/community/communities" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$2\"}" | json_field 'data.id'
}

join_community() {  # $1=token $2=name
  curl -s --max-time 20 -o /dev/null -X POST \
    "$SITE/api/community/communities/$(enc "$2")/membership" -H "Authorization: Bearer $1"
}

create_post() {  # $1=token $2=communityId $3=title → id
  curl -s --max-time 20 -X POST "$SITE/api/content/posts" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"communityId\":\"$2\",\"title\":\"$3\",\"body\":\"e2e P5.5 正文\"}" | json_field 'data.id'
}

favorite_post() {  # $1=token $2=postId
  curl -s --max-time 20 -o /dev/null -X POST "$SITE/api/interaction/favorites" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"targetType\":\"post\",\"targetId\":\"$2\"}"
}

api_post() {  # $1=url $2=token(可空) $3=body → 响应体
  local token="${2:-}"
  if [ -n "$token" ]; then
    curl -s --max-time 20 -X POST "$1" -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -d "$3"
  else
    curl -s --max-time 20 -X POST "$1" -H 'Content-Type: application/json' -d "$3"
  fi
}

api_get() {  # $1=url $2=token(可空) → 响应体
  local token="${2:-}"
  if [ -n "$token" ]; then
    curl -s --max-time 20 "$1" -H "Authorization: Bearer $token"
  else
    curl -s --max-time 20 "$1"
  fi
}

# ---------------------------------------------------------------- 清理

cleanup() {
  local ids out
  ids=$(sql_exec "SELECT IFNULL(GROUP_CONCAT(id), 0) FROM kuaikan_user.t_user
      WHERE email LIKE 'e2e+p55%@kuaikan.test';" | tr -d '\r\n ')
  [ -z "$ids" ] && ids=0
  if [ -z "$P55_IDS" ] && [ "$ids" != "0" ]; then
    P55_IDS="$ids"
  fi

  # 多表 DELETE 必须在 USE 之后：`DELETE c FROM a c JOIN b ...` 在没选默认库时
  # 直接报 `No database selected`，而 sql_exec 把 stderr 丢掉了——
  # 于是"清理成功"是一句假话，测试数据会一直堆在库里（这里踩过一次）。
  # 清理用保留 stderr 的 sql_exec_v，就是为了让这种情况能红出来。
  out=$(sql_exec_v "
    USE kuaikan_interaction;
    DELETE FROM t_interaction WHERE user_id IN ($ids);
    USE kuaikan_notification;
    DELETE FROM t_message WHERE user_id IN ($ids) OR actor_id IN ($ids);
    USE kuaikan_user;
    DELETE FROM t_user_follow WHERE follower_id IN ($ids) OR followee_id IN ($ids);
    DELETE FROM t_refresh_token WHERE user_id IN ($ids);
    DELETE FROM t_outbox WHERE topic = 'kuaikan_user_followed' AND payload LIKE '%e2e-p55%';
    DELETE FROM t_user WHERE email LIKE 'e2e+p55%@kuaikan.test';
    USE kuaikan_content;
    DELETE c FROM t_comment c
      JOIN t_post p ON p.id = c.post_id
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p55%';
    DELETE p FROM t_post p
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p55%';
    DELETE c FROM t_comment c
      JOIN t_post p ON p.id = c.post_id
      LEFT JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.id IS NULL;
    DELETE p FROM t_post p
      LEFT JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.id IS NULL;
    DELETE FROM kuaikan_interaction.t_interaction
      WHERE (target_type = 1 AND target_id NOT IN (SELECT id FROM t_post))
         OR (target_type = 2 AND target_id NOT IN (SELECT id FROM t_comment));
    USE kuaikan_community;
    DELETE m FROM t_community_member m
      JOIN t_community c ON c.id = m.community_id
      WHERE c.name LIKE 'e2e-p55%';
    DELETE FROM t_community WHERE name LIKE 'e2e-p55%';")
  case "$out" in
    *ERROR*) printf '  %s清理失败%s %s\n' "$R" "$N" "$(printf '%s' "$out" | head -3 | tr '\n' ' ')" ;;
    *) [ "$CLEANUP_NEEDED" = "1" ] && info "已清理 P5.5 测试账号、社群、帖子、关注、收藏、消息" ;;
  esac

  # Redis：先按反向索引找到该用户全部 access jti，删正向白名单键，再删索引本身。
  # 只删本次夹具的 id，不做 `--scan auth:*` 全清（那会顺手踢掉真实用户）。
  if [ "$CLEANUP_NEEDED" = "1" ] && [ "$P55_IDS" != "0" ]; then
    redis_exec "for uid in $(printf '%s' "$P55_IDS" | tr ',' ' '); do
      for jti in \$(redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZRANGE \"auth:user:\$uid:access\" 0 -1); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:session:\$jti\" >/dev/null
      done
      redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:user:\$uid:access\" >/dev/null
    done" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

# ================================================================ L0 静态与契约

if want_layer l0; then
  section "L0 静态与契约"

  out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1) \
    && ok "错误码契约三方一致" \
    || ng "错误码契约不一致" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"

  out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1) \
    && ok "OpenAPI 与网关放行规则一致" \
    || ng "OpenAPI 与放行规则不一致" "$(printf '%s' "$out" | sed -n '2p')"

  out=$(node "$APP_DIR/deploy/bin/check-scripts.mjs" 2>&1) \
    && ok "shell 脚本静态检查通过（含本脚本）" \
    || ng "shell 脚本静态检查" "$(printf '%s' "$out" | sed -n '2p')"

  # P5.5.0 冻结的 5 个错误码：验收脚本假定它们存在，这里先证明它们真的登记了
  missing_codes=""
  for code in 40207 40208 40209 40210 40211; do
    grep -qE "\"code\": $code([^0-9]|$)" "$APP_DIR/contract/error-codes.json" || missing_codes="$missing_codes $code"
  done
  [ -z "$missing_codes" ] && ok "P5.5 的 5 个错误码已登记（40207~40211）" \
    || ng "错误码契约缺项" "$missing_codes"

  # 游客只读四条必须在白名单里；登录态端点必须不在
  whitelist_ok=1
  for pat in 'GET ^/api/user/users/[^/]+/profile$' \
             'GET ^/api/user/users/[^/]+/following$' \
             'GET ^/api/user/users/[^/]+/followers$' \
             'GET ^/api/community/users/[^/]+/communities$'; do
    grep -Fq "$pat" "$APP_DIR/services/gateway/src/main/resources/application.yml" || whitelist_ok=0
  done
  [ "$whitelist_ok" = "1" ] && ok "四个游客只读端点都在网关白名单里" \
    || ng "网关白名单缺少游客只读规则"

  leaked=""
  for pat in 'by-authors' 'posts/batch' 'interaction/favorites' 'follows/states' 'me/following/ids' 'auth/password'; do
    if grep -E '^\s+- (GET|POST|DELETE) ' "$APP_DIR/services/gateway/src/main/resources/application.yml" | grep -q "$pat"; then
      leaked="$leaked $pat"
    fi
  done
  [ -z "$leaked" ] && ok "登录态端点没有被误放行到白名单" || ng "白名单误放行了登录态端点" "$leaked"

  if [ -d "$WEB_DIR/node_modules" ]; then
    ( cd "$WEB_DIR" && npm run gen:types >/dev/null 2>&1 )
    drift=$(cd "$APP_DIR" && git status --porcelain -- web/src/shared/api/types 2>/dev/null)
    [ -z "$drift" ] && ok "前端类型与 spec 无漂移" \
      || ng "前端类型有漂移" "$(printf '%s' "$drift" | head -2 | tr '\n' ' ')"

    ( cd "$WEB_DIR" && npm run typecheck >/dev/null 2>&1 ) \
      && ok "web typecheck 通过" || ng "web typecheck 失败"
    ( cd "$WEB_DIR" && npm run lint >/dev/null 2>&1 ) \
      && ok "web lint 通过" || ng "web lint 失败"
    ( cd "$WEB_DIR" && npm run build >/dev/null 2>&1 ) \
      && ok "web build 通过" || ng "web build 失败"
  else
    skip "前端类型 / typecheck / lint / build" "缺少 web/node_modules"
  fi

  # 工作区干净只在全量时检查：单独跑 --layer 时工作区本来就可能脏
  if [ -z "$ONLY_LAYER_NORM" ]; then
    dirty=$(cd "$APP_DIR" && git status --porcelain 2>/dev/null)
    [ -z "$dirty" ] && ok "工作区干净（全量验收的前置条件）" \
      || ng "工作区有未提交改动" "$(printf '%s' "$dirty" | head -3 | tr '\n' ' ')"
  else
    skip "工作区干净" "只跑 ${ONLY_LAYER_NORM}"
  fi
fi

# ================================================================ L1 基础设施与迁移

if want_layer l1; then
  section "L1 基础设施与迁移"

  out=$(ssh_run 'for c in gateway user-service community-service content-service interaction-service \
      notification-service search-service rank-service mysql redis nacos rmq-namesrv rmq-broker; do
      printf "%s=%s\n" "$c" "$(docker inspect -f "{{.State.Health.Status}}" "kuaikan-$c-1" 2>/dev/null)"
    done')
  unhealthy=""
  for name in gateway user-service community-service content-service interaction-service \
              notification-service search-service rank-service mysql redis nacos rmq-namesrv rmq-broker; do
    st=$(printf '%s\n' "$out" | grep "^${name}=" | head -1 | cut -d= -f2)
    [ "$st" = "healthy" ] || unhealthy="$unhealthy ${name}(${st:-unknown})"
  done
  [ -z "$unhealthy" ] && ok "13 个容器全部 healthy" || ng "容器不健康" "$unhealthy"

  cols=$(sql_exec "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION)
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='kuaikan_user' AND TABLE_NAME='t_user_follow';" | tr -d '\r\n ')
  [ "$cols" = "id,follower_id,followee_id,created_at" ] \
    && ok "t_user_follow 列结构正确" || ng "t_user_follow 列不对" "实得 ${cols:-空}"

  idx=$(sql_exec "SELECT GROUP_CONCAT(DISTINCT INDEX_NAME ORDER BY INDEX_NAME)
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='kuaikan_user' AND TABLE_NAME='t_user_follow';" | tr -d '\r\n ')
  [ "$idx" = "idx_followee_created,idx_follower_created,PRIMARY,uk_follower_followee" ] \
    && ok "t_user_follow 有唯一键与两条时间线索引" || ng "t_user_follow 索引不全" "实得 ${idx:-空}"

  uk=$(sql_exec "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='kuaikan_user' AND TABLE_NAME='t_user_follow'
        AND INDEX_NAME='uk_follower_followee';" | tr -d '\r\n ')
  [ "$uk" = "follower_id,followee_id" ] \
    && ok "唯一键钉在 (follower_id, followee_id) 上（关注幂等的底座）" || ng "唯一键列不对" "实得 ${uk:-空}"

  cool=$(sql_exec "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='kuaikan_notification' AND TABLE_NAME='t_message'
        AND INDEX_NAME='idx_follow_cooldown';" | tr -d '\r\n ')
  [ "$cool" = "user_id,type,actor_id,created_at" ] \
    && ok "t_message 有 24h 冷却查询索引" || ng "缺 idx_follow_cooldown" "实得 ${cool:-空}"

  fav=$(sql_exec "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='kuaikan_interaction' AND TABLE_NAME='t_interaction'
        AND INDEX_NAME='idx_user_kind_created';" | tr -d '\r\n ')
  [ "$fav" = "user_id,kind,target_type,created_at,id" ] \
    && ok "t_interaction 有我的收藏分页索引" || ng "缺 idx_user_kind_created" "实得 ${fav:-空}"

  mig_missing=""
  for f in services/user-service/src/main/resources/db/migration/V4__create_user_follow.sql \
           services/notification-service/src/main/resources/db/migration/V4__follow_cooldown_index.sql \
           services/interaction-service/src/main/resources/db/migration/V3__user_kind_created_index.sql; do
    [ -f "$APP_DIR/$f" ] || mig_missing="$mig_missing $(basename "$f")"
  done
  [ -z "$mig_missing" ] && ok "三处迁移脚本都在库里" || ng "迁移脚本缺失" "$mig_missing"

  grep -q 'kuaikan_user_followed' "$APP_DIR/services/kuaikan-common/src/main/java/top/katzenyasax/kuaikan/common/mq/Topics.java" \
    && grep -q 'kuaikan_user_followed' "$APP_DIR/deploy/bin/init-topics.sh" \
    && ok "FOLLOW topic 常量与 init-topics 一致（下划线，无点号）" \
    || ng "FOLLOW topic 常量或 init-topics 缺项"

  grep -q 'follow-consumer-group: kuaikan-notification-follow-consumer' \
    "$APP_DIR/services/notification-service/src/main/resources/application.yml" \
    && ok "FOLLOW 消费组独立命名（不与既有消费组复用）" || ng "FOLLOW 消费组配置缺失"

  topics=$(ssh_run "docker exec kuaikan-rmq-broker-1 sh $MQ_BIN topicList -n $MQ_NAMESRV 2>/dev/null")
  printf '%s\n' "$topics" | grep -qx 'kuaikan_user_followed' \
    && ok "RocketMQ 上 kuaikan_user_followed 已创建" || ng "RocketMQ 上没有 kuaikan_user_followed"

  cons=$(ssh_run "docker exec kuaikan-rmq-broker-1 sh $MQ_BIN consumerProgress -n $MQ_NAMESRV \
      -g kuaikan-notification-follow-consumer 2>/dev/null")
  rows=$(printf '%s\n' "$cons" | grep -c '^kuaikan_user_followed')
  [ "${rows:-0}" -ge 1 ] && ok "消费组已订阅 kuaikan_user_followed（${rows} 个队列）" \
    || ng "消费组没有订阅 kuaikan_user_followed"

  # 积压必须是 0：有积压说明消费者没在跑，"冷却去重"之类的断言会全部失真
  diff=""
  for _ in $(seq 1 10); do
    diff=$(printf '%s\n' "$cons" | awk '$1=="kuaikan_user_followed"{s+=$6} END{print s+0}')
    [ "$diff" = "0" ] && break
    sleep 2
    cons=$(ssh_run "docker exec kuaikan-rmq-broker-1 sh $MQ_BIN consumerProgress -n $MQ_NAMESRV \
        -g kuaikan-notification-follow-consumer 2>/dev/null")
  done
  [ "$diff" = "0" ] && ok "FOLLOW 消费组没有积压（Diff=0）" || ng "FOLLOW 消费组有积压" "Diff=$diff"
fi

# ================================================================ L2 后端 HTTP

L2_READY=0
L2_STEP=""

prepare_l2() {
  [ "$L2_READY" = "1" ] && return 0
  L2_STEP="SSH"
  ssh_run 'true' || return 1

  L2_EMAIL_A="e2e+p55l2a${STAMP}@kuaikan.test"
  L2_EMAIL_B="e2e+p55l2b${STAMP}@kuaikan.test"
  L2_NICK_A="e2e-p55l2a-${STAMP}"
  L2_NICK_B="e2e-p55l2b-${STAMP}"
  L2_C1_NAME="e2e-p55-l2-1-${STAMP}"
  L2_C2_NAME="e2e-p55-l2-2-${STAMP}"

  L2_STEP="建测试账号"
  L2_A_ID=$(mk_user "$L2_EMAIL_A" "$L2_NICK_A")
  L2_B_ID=$(mk_user "$L2_EMAIL_B" "$L2_NICK_B")
  [ -n "$L2_A_ID" ] && [ -n "$L2_B_ID" ] || return 1
  CLEANUP_NEEDED=1

  L2_STEP="账号登录"
  L2_TA=$(login_token "$L2_EMAIL_A" "$FIXTURE_PASS")
  L2_TB=$(login_token "$L2_EMAIL_B" "$FIXTURE_PASS")
  [ -n "$L2_TA" ] && [ -n "$L2_TB" ] || return 1

  L2_STEP="建社群"
  L2_C1_ID=$(create_community "$L2_TA" "$L2_C1_NAME")
  L2_C2_ID=$(create_community "$L2_TA" "$L2_C2_NAME")
  [ -n "$L2_C1_ID" ] && [ -n "$L2_C2_ID" ] || return 1
  join_community "$L2_TB" "$L2_C1_NAME"

  L2_STEP="发帖"
  L2_PB1=$(create_post "$L2_TB" "$L2_C1_ID" "e2e P5.5 B 帖 1")
  L2_PB2=$(create_post "$L2_TB" "$L2_C1_ID" "e2e P5.5 B 帖 2")
  L2_PB3=$(create_post "$L2_TB" "$L2_C1_ID" "e2e P5.5 B 帖 3")
  L2_PA1=$(create_post "$L2_TA" "$L2_C1_ID" "e2e P5.5 A 帖 1")
  [ -n "$L2_PB1" ] && [ -n "$L2_PB2" ] && [ -n "$L2_PB3" ] && [ -n "$L2_PA1" ] || return 1

  L2_STEP="收藏"
  favorite_post "$L2_TA" "$L2_PA1"
  favorite_post "$L2_TA" "$L2_PB2"

  info "L2 夹具：A=$L2_A_ID B=$L2_B_ID 社群=$L2_C1_ID/$L2_C2_ID 帖子=$L2_PA1/$L2_PB1..3"
  L2_STEP=""
  L2_READY=1
  return 0
}

# 等一条 FOLLOW 消息落库（outbox → MQ → 消费者是异步的）
wait_follow_msg() {  # $1=token $2=最少条数
  local i n
  for i in $(seq 1 20); do
    n=$(api_get "$SITE/api/notification/messages?type=FOLLOW&limit=50" "$1" \
      | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data']
except Exception: print(0); raise SystemExit(0)
print(len(d.get('items') or []))" 2>/dev/null)
    [ "${n:-0}" -ge "$2" ] && { printf '%s' "$n"; return 0; }
    sleep 1
  done
  printf '%s' "${n:-0}"
  return 1
}

follow_msg_count() {
  api_get "$SITE/api/notification/messages?type=FOLLOW&limit=50" "$1" \
    | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data']
except Exception: print(0); raise SystemExit(0)
print(len(d.get('items') or []))" 2>/dev/null
}

if want_layer l2; then
  section "L2 后端 HTTP 契约与边界"

  if ! prepare_l2; then
    ng "创建 L2 夹具失败" "失败在：${L2_STEP:-未知}"
  else
    api="$SITE/api"
    follow_url="$api/user/users/$L2_B_ID/follow"

    # ---------------- 关注写路径
    code=$(http_code "$SITE/api/user/users/$L2_B_ID/follow" 2>/dev/null)
    [ "${code:-0}" -ge 400 ] 2>/dev/null \
      && ok "游客关注返回 4xx（网关挡住）" || ng "游客关注没有被拦截" "HTTP ${code:-000}"

    body=$(api_post "$follow_url" "$L2_TA" '{}')
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "A 关注 B 成功" || ng "关注失败" "$(printf '%s' "$body" | head -c 120)"

    dup_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user_follow
        WHERE follower_id=$L2_A_ID AND followee_id=$L2_B_ID;" | tr -d '\r\n ')
    body=$(api_post "$follow_url" "$L2_TA" '{}')
    dup2=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user_follow
        WHERE follower_id=$L2_A_ID AND followee_id=$L2_B_ID;" | tr -d '\r\n ')
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] && [ "$dup_count" = "1" ] && [ "$dup2" = "1" ] \
      && ok "重复关注是幂等的（返回成功且库里仍 1 行）" \
      || ng "重复关注不幂等" "响应 code=$(printf '%s' "$body" | json_field 'code') 行数 $dup_count → $dup2"

    body=$(api_post "$SITE/api/user/users/$L2_A_ID/follow" "$L2_TA" '{}')
    hc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$SITE/api/user/users/$L2_A_ID/follow" \
      -H "Authorization: Bearer $L2_TA")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40210" ] && [ "$hc" = "200" ] \
      && ok "自己关注自己 → HTTP 200 + 40210" || ng "自关注未按契约拒绝" "code=$(printf '%s' "$body" | json_field 'code') HTTP $hc"

    bogus=999999999999999999
    hc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$SITE/api/user/users/$bogus/follow" \
      -H "Authorization: Bearer $L2_TA")
    body=$(api_post "$SITE/api/user/users/$bogus/follow" "$L2_TA" '{}')
    [ "$hc" = "404" ] && [ "$(printf '%s' "$body" | json_field 'code')" = "40209" ] \
      && ok "关注不存在的用户 → HTTP 404 + 40209" || ng "不存在用户未按契约返回" "HTTP $hc code=$(printf '%s' "$body" | json_field 'code')"

    # ---------------- 游客白名单与鉴权边界
    hc=$(http_code "$SITE/api/user/users/$L2_B_ID/profile")
    cnt=$(api_get "$SITE/api/user/users/$L2_B_ID/profile" | json_field 'data.followerCount')
    [ "$hc" = "200" ] && [ "$cnt" = "1" ] \
      && ok "游客可读用户资料，粉丝数是 1（派生计数）" || ng "游客读资料不对" "HTTP $hc followerCount=${cnt:-空}"

    guest_401=""
    for u in "$SITE/api/user/follows/states?userIds=$L2_B_ID" \
             "$SITE/api/user/me/following/ids" \
             "$SITE/api/interaction/favorites" ; do
      c=$(http_code "$u")
      [ "$c" = "401" ] || guest_401="$guest_401 ${u##*/}($c)"
    done
    for u in "$SITE/api/content/posts/by-authors" "$SITE/api/content/posts/batch"; do
      c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$u" \
        -H 'Content-Type: application/json' -d '{}')
      [ "$c" = "401" ] || guest_401="$guest_401 ${u##*/}($c)"
    done
    [ -z "$guest_401" ] && ok "登录态端点对游客一律 401（5 条）" || ng "有端点对游客没拦" "$guest_401"

    # 游客只读四条
    read_bad=""
    c=$(http_code "$SITE/api/user/users/$L2_B_ID/following")
    [ "$c" = "200" ] || read_bad="$read_bad following($c)"
    c=$(http_code "$SITE/api/user/users/$L2_B_ID/followers")
    [ "$c" = "200" ] || read_bad="$read_bad followers($c)"
    c=$(http_code "$SITE/api/community/users/$L2_A_ID/communities")
    [ "$c" = "200" ] || read_bad="$read_bad communities($c)"
    c=$(http_code "$SITE/api/content/posts?authorId=$L2_B_ID&limit=5")
    [ "$c" = "200" ] || read_bad="$read_bad byAuthor($c)"
    [ -z "$read_bad" ] && ok "四个游客只读端点全部 200" || ng "游客只读端点不可读" "$read_bad"

    # ---------------- 关系状态与列表
    st=$(api_get "$SITE/api/user/follows/states?userIds=$L2_B_ID" "$L2_TA")
    [ "$(printf '%s' "$st" | json_field "data.$L2_B_ID.following")" = "True" ] \
      && [ "$(printf '%s' "$st" | json_field "data.$L2_B_ID.followedBy")" = "False" ] \
      && ok "states 反映单向关注（following=true followedBy=false）" \
      || ng "states 单向状态不对" "$(printf '%s' "$st" | head -c 120)"

    api_post "$SITE/api/user/users/$L2_A_ID/follow" "$L2_TB" '{}' >/dev/null
    st=$(api_get "$SITE/api/user/follows/states?userIds=$L2_B_ID" "$L2_TA")
    [ "$(printf '%s' "$st" | json_field "data.$L2_B_ID.following")" = "True" ] \
      && [ "$(printf '%s' "$st" | json_field "data.$L2_B_ID.followedBy")" = "True" ] \
      && ok "互相关注时 followedBy 也变 true（前端渲染「互相关注」）" \
      || ng "互关状态不对" "$(printf '%s' "$st" | head -c 120)"

    myfollow=$(api_get "$SITE/api/user/me/following/ids" "$L2_TA")
    has_b=$(printf '%s' "$myfollow" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data'] or []
except Exception: print('no'); raise SystemExit(0)
print('yes' if any(str(u.get('userId'))=='$L2_B_ID' for u in d) else 'no')" 2>/dev/null)
    [ "$has_b" = "yes" ] && ok "我关注的人列表包含 B（/following 左栏数据源）" \
      || ng "我关注的人列表没有 B" "$(printf '%s' "$myfollow" | head -c 120)"

    fl=$(api_get "$SITE/api/user/users/$L2_A_ID/following")
    [ "$(printf '%s' "$fl" | json_field "data.items.0.userId")" = "$L2_B_ID" ] \
      && ok "A 的关注列表按游标返回 B" || ng "A 的关注列表不对" "$(printf '%s' "$fl" | head -c 120)"

    fr=$(api_get "$SITE/api/user/users/$L2_B_ID/followers")
    [ "$(printf '%s' "$fr" | json_field "data.items.0.userId")" = "$L2_A_ID" ] \
      && ok "B 的粉丝列表按游标返回 A" || ng "B 的粉丝列表不对" "$(printf '%s' "$fr" | head -c 120)"

    # ---------------- FOLLOW 消息与 24h 冷却
    n=$(wait_follow_msg "$L2_TB" 1)
    msg=$(api_get "$SITE/api/notification/messages?type=FOLLOW&limit=5" "$L2_TB")
    got_actor=$(printf '%s' "$msg" | json_field 'data.items.0.actorId')
    got_nick=$(printf '%s' "$msg" | json_field 'data.items.0.actorNickname')
    if [ "${n:-0}" -ge 1 ] && [ "$got_actor" = "$L2_A_ID" ] && [ "$got_nick" = "$L2_NICK_A" ]; then
      ok "关注后 B 收到 FOLLOW 消息（含 actorId 与昵称快照，无需回查）" "${n} 条"
    else
      ng "FOLLOW 消息没有正确落库" "条数=${n:-0} actor=${got_actor:-空} nick=${got_nick:-空}"
    fi
    unread_follow=$(api_get "$SITE/api/notification/unread" "$L2_TB" | json_field 'data.follow')
    [ -n "$unread_follow" ] && [ "${unread_follow:-0}" -ge 1 ] 2>/dev/null \
      && ok "未读接口有 follow 字段且计数为 ${unread_follow}" || ng "未读接口的 follow 字段不对" "${unread_follow:-空}"

    before=$(follow_msg_count "$L2_TB")
    outbox_before=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_outbox
        WHERE topic='kuaikan_user_followed' AND payload LIKE '%$L2_B_ID%';" | tr -d '\r\n ')
    curl -s --max-time 20 -o /dev/null -X DELETE "$follow_url" -H "Authorization: Bearer $L2_TA"
    api_post "$follow_url" "$L2_TA" '{}' >/dev/null
    outbox_after=""
    for _ in $(seq 1 10); do
      outbox_after=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_outbox
          WHERE topic='kuaikan_user_followed' AND payload LIKE '%$L2_B_ID%';" | tr -d '\r\n ')
      [ "${outbox_after:-0}" -gt "${outbox_before:-0}" ] 2>/dev/null && break
      sleep 1
    done
    [ "${outbox_after:-0}" -gt "${outbox_before:-0}" ] 2>/dev/null \
      && ok "取关再关注确实又发了一条事件（产生路径通）" || ng "没有新事件，冷却断言会变得无意义" \
        "outbox $outbox_before → ${outbox_after:-空}"
    sleep 6
    after=$(follow_msg_count "$L2_TB")
    [ "$before" = "$after" ] \
      && ok "24h 内同一人再次关注不产生第二条消息（冷却）" \
      || ng "冷却失效，产生了重复关注消息" "$before → $after"

    # ---------------- 单作者 / 多作者帖子
    page=$(api_get "$SITE/api/content/posts?authorId=$L2_B_ID&limit=2")
    authors=$(printf '%s' "$page" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data']
except Exception: print('bad'); raise SystemExit(0)
items=d.get('items') or []
print(','.join(sorted({str(i.get('authorId')) for i in items})) if items else 'empty')" 2>/dev/null)
    [ "$authors" = "$L2_B_ID" ] && ok "按 authorId 查帖只返回该作者的帖子（游客可读）" \
      || ng "按 authorId 查帖混入了别人的帖子" "$authors"

    cursor_a=$(printf '%s' "$page" | json_field 'data.nextCursor')
    page2=$(api_get "$SITE/api/content/posts?authorId=$L2_B_ID&limit=2&cursor=$(enc "$cursor_a")")
    p1=$(printf '%s' "$page" | json_field 'data.items.0.id')
    p2=$(printf '%s' "$page2" | json_field 'data.items.0.id')
    [ -n "$cursor_a" ] && [ -n "$p2" ] && [ "$p1" != "$p2" ] \
      && ok "按作者分页的游标不重复返回同一条" || ng "按作者分页有重复或没有游标" "$p1 / ${p2:-空}"

    both=$(api_get "$SITE/api/content/posts?communityId=$L2_C1_ID&authorId=$L2_B_ID")
    [ "$(printf '%s' "$both" | json_field 'code')" = "40010" ] \
      && ok "同时传 communityId 与 authorId → 40010" || ng "两个过滤条件被同时接受"
    neither=$(api_get "$SITE/api/content/posts")
    [ "$(printf '%s' "$neither" | json_field 'code')" = "40010" ] \
      && ok "两个过滤条件都不传 → 40010" || ng "缺过滤条件没有被拒绝"

    cross1=$(api_get "$SITE/api/content/posts?communityId=$L2_C1_ID&limit=1")
    cursor_c=$(printf '%s' "$cross1" | json_field 'data.nextCursor')
    if [ -n "$cursor_c" ]; then
      bad=$(api_get "$SITE/api/content/posts?communityId=$L2_C1_ID&limit=1&cursor=$(enc "$cursor_a")")
      [ "$(printf '%s' "$bad" | json_field 'code')" = "40010" ] \
        && ok "把按作者的游标喂给社群列表 → 40010（排序标记隔离）" \
        || ng "跨列表游标被接受了（作者→社群）"
      bad=$(api_get "$SITE/api/content/posts?authorId=$L2_B_ID&limit=1&cursor=$(enc "$cursor_c")")
      [ "$(printf '%s' "$bad" | json_field 'code')" = "40010" ] \
        && ok "把社群列表的游标喂给按作者列表 → 40010" \
        || ng "跨列表游标被接受了（社群→作者）"
    else
      skip "跨列表游标隔离" "社群帖不足 2 条，拿不到社群游标"
    fi

    ba=$(api_post "$SITE/api/content/posts/by-authors" "$L2_TA" \
      "{\"authorIds\":[\"$L2_A_ID\",\"$L2_B_ID\"],\"limit\":2}")
    ba_authors=$(printf '%s' "$ba" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data']
except Exception: print('bad'); raise SystemExit(0)
items=d.get('items') or []
print(len({str(i.get('authorId')) for i in items}))" 2>/dev/null)
    [ "$ba_authors" = "2" ] && ok "多作者时间线同时返回两位作者的帖子" \
      || ng "多作者时间线只返回了一位作者" "distinct=${ba_authors:-空}"

    many=$(python3 -c "import json;print(json.dumps({'authorIds':[str(i) for i in range(1,202)]}))")
    body=$(api_post "$SITE/api/content/posts/by-authors" "$L2_TA" "$many")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "by-authors 传 201 个 id → 40010（上限 200）" || ng "201 个作者 id 没有被拒绝"

    # ---------------- 用户已加入的社群
    uc=$(api_get "$SITE/api/community/users/$L2_A_ID/communities?limit=1")
    uc_first=$(printf '%s' "$uc" | json_field 'data.items.0.id')
    uc_cursor=$(printf '%s' "$uc" | json_field 'data.nextCursor')
    uc2=$(api_get "$SITE/api/community/users/$L2_A_ID/communities?limit=1&cursor=$(enc "$uc_cursor")")
    uc_second=$(printf '%s' "$uc2" | json_field 'data.items.0.id')
    [ -n "$uc_first" ] && [ -n "$uc_cursor" ] && [ -n "$uc_second" ] && [ "$uc_first" != "$uc_second" ] \
      && ok "用户社群列表游客可读且游标翻页不重不漏" \
      || ng "用户社群分页不对" "$uc_first / ${uc_second:-空} cursor=${uc_cursor:-空}"

    # ---------------- 我的收藏
    favs=$(api_get "$SITE/api/interaction/favorites?limit=1" "$L2_TA")
    fav1=$(printf '%s' "$favs" | json_field 'data.items.0.postId')
    fav_cursor=$(printf '%s' "$favs" | json_field 'data.nextCursor')
    favs2=$(api_get "$SITE/api/interaction/favorites?limit=1&cursor=$(enc "$fav_cursor")" "$L2_TA")
    fav2=$(printf '%s' "$favs2" | json_field 'data.items.0.postId')
    [ -n "$fav1" ] && [ -n "$fav_cursor" ] && [ -n "$fav2" ] && [ "$fav1" != "$fav2" ] \
      && ok "我的收藏按游标分页且不重复" || ng "收藏分页不对" "$fav1 / ${fav2:-空}"

    bad=$(api_get "$SITE/api/interaction/favorites?limit=1&cursor=$(enc "$cursor_a")" "$L2_TA")
    [ "$(printf '%s' "$bad" | json_field 'code')" = "40010" ] \
      && ok "把帖子列表的游标喂给收藏列表 → 40010" || ng "收藏列表接受了别的列表的游标"

    batch=$(api_post "$SITE/api/content/posts/batch" "$L2_TA" \
      "{\"ids\":[\"$L2_PA1\",\"$L2_PB2\"]}")
    batch_n=$(printf '%s' "$batch" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['data'] or []))
except Exception: print(0)" 2>/dev/null)
    [ "$batch_n" = "2" ] && ok "批量查帖子摘要返回两条（正常帖都补齐）" || ng "批量摘要条数不对" "$batch_n"

    sql_exec "UPDATE kuaikan_content.t_post SET status = 0 WHERE id = $L2_PB2;" >/dev/null
    batch=$(api_post "$SITE/api/content/posts/batch" "$L2_TA" \
      "{\"ids\":[\"$L2_PA1\",\"$L2_PB2\"]}")
    has_deleted=$(printf '%s' "$batch" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data'] or []
except Exception: print('bad'); raise SystemExit(0)
print('yes' if any(str(p.get('id'))=='$L2_PB2' for p in d) else 'no')" 2>/dev/null)
    [ "$has_deleted" = "no" ] && [ "$batch_n" = "2" ] \
      && ok "已删帖在批量摘要里缺席（前端据此渲染灰色占位）" \
      || ng "批量摘要仍然返回了已删帖"

    many=$(python3 -c "import json;print(json.dumps({'ids':[str(i) for i in range(1,52)]}))")
    body=$(api_post "$SITE/api/content/posts/batch" "$L2_TA" "$many")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "batch 传 51 个 id → 40010（上限 50）" || ng "51 个帖子 id 没有被拒绝"

    # 已删帖也必须能取消收藏：灰色占位行上唯一的操作就是它（p55-social.md §7）。
    # 这条用 curl 断言而不是只靠浏览器：失败时能直接看到业务码，
    # 不必从“占位没消失”去反推。
    hc=$(curl -s -o /tmp/p55-unfav.json -w '%{http_code}' --max-time 20 -X DELETE \
      "$SITE/api/interaction/favorites?targetType=post&targetId=$L2_PB2" \
      -H "Authorization: Bearer $L2_TA")
    unfav_code=$(json_field 'code' < /tmp/p55-unfav.json)
    left=$(api_get "$SITE/api/interaction/favorites?limit=50" "$L2_TA" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data']
except Exception: print('bad'); raise SystemExit(0)
items=d.get('items') or []
print('yes' if any(str(i.get('postId'))=='$L2_PB2' for i in items) else 'no')" 2>/dev/null)
    rm -f /tmp/p55-unfav.json
    [ "$hc" = "200" ] && [ "$unfav_code" = "0" ] && [ "$left" = "no" ] \
      && ok "已删帖也能取消收藏（占位行的操作可用）" \
      || ng "已删帖无法取消收藏（占位行变成死胡同）" "HTTP $hc code=${unfav_code:-空} 仍在列表=${left:-空}"

    # ---------------- 修改密码：双端登录 → 全端失效
    jar_dir=$(mktemp -d)
    t_a1=$(login_token_jar "$L2_EMAIL_A" "$FIXTURE_PASS" "$jar_dir/a1.txt")
    t_a2=$(login_token_jar "$L2_EMAIL_A" "$FIXTURE_PASS" "$jar_dir/a2.txt")
    if [ -z "$t_a1" ] || [ -z "$t_a2" ]; then
      ng "双端登录失败，改密无法验证"
    else
      body=$(api_post "$SITE/api/user/auth/password" "$t_a1" \
        "{\"oldPassword\":\"Wrong-Old-Passw0rd\",\"newPassword\":\"$FIXTURE_NEW_PASS\"}")
      still=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/user/auth/me" \
        -H "Authorization: Bearer $t_a1")
      [ "$(printf '%s' "$body" | json_field 'code')" = "40207" ] && [ "$still" = "200" ] \
        && ok "旧密码错 → HTTP 200 + 40207，且当前会话不掉线" \
        || ng "旧密码错误处理不对" "code=$(printf '%s' "$body" | json_field 'code') HTTP $still"

      body=$(api_post "$SITE/api/user/auth/password" "$t_a1" \
        "{\"oldPassword\":\"$FIXTURE_PASS\",\"newPassword\":\"$FIXTURE_PASS\"}")
      [ "$(printf '%s' "$body" | json_field 'code')" = "40208" ] \
        && ok "新旧密码相同 → HTTP 200 + 40208" || ng "相同密码没有被拒绝"

      hdr="$jar_dir/hdr.txt"
      hc=$(curl -s -o "$jar_dir/body.json" -D "$hdr" -w '%{http_code}' --max-time 20 \
        -X POST "$SITE/api/user/auth/password" -H "Authorization: Bearer $t_a1" \
        -H 'Content-Type: application/json' \
        -d "{\"oldPassword\":\"$FIXTURE_PASS\",\"newPassword\":\"$FIXTURE_NEW_PASS\"}")
      body_code=$(json_field 'code' < "$jar_dir/body.json")
      cleared=$(grep -ci 'set-cookie: kuaikan_refresh=.*Max-Age=0' "$hdr" || true)
      [ "$hc" = "200" ] && [ "$body_code" = "0" ] && [ "${cleared:-0}" -ge 1 ] \
        && ok "改密成功并下发清 cookie（Max-Age=0）" \
        || ng "改密响应不符合契约" "HTTP $hc code=${body_code:-空} cookie=${cleared:-0}"

      gone1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/user/auth/me" \
        -H "Authorization: Bearer $t_a1")
      gone2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/user/auth/me" \
        -H "Authorization: Bearer $t_a2")
      [ "$gone1" = "401" ] && [ "$gone2" = "401" ] \
        && ok "改密后两端的 access 都立刻失效（401）" \
        || ng "改密后仍有 access 可用" "本端 $gone1 另一端 $gone2"

      rc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
        "$SITE/api/user/auth/refresh" -b "$jar_dir/a2.txt")
      [ "$rc" = "401" ] && ok "另一端的 refresh 也失效（401，全端下线）" \
        || ng "另一端的 refresh 仍可用" "HTTP $rc"

      old_login=$(curl -s --max-time 20 -X POST "$SITE/api/user/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"$L2_EMAIL_A\",\"password\":\"$FIXTURE_PASS\"}")
      [ "$(printf '%s' "$old_login" | json_field 'code')" = "40206" ] \
        && ok "旧密码登录被拒绝（40206）" || ng "旧密码还能登录"

      new_tok=$(login_token "$L2_EMAIL_A" "$FIXTURE_NEW_PASS")
      mehc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/user/auth/me" \
        -H "Authorization: Bearer $new_tok")
      [ -n "$new_tok" ] && [ "$mehc" = "200" ] \
        && ok "新密码可以登录且 access 可用" || ng "新密码登录失败" "token=${new_tok:+有} HTTP $mehc"
    fi
    rm -rf "$jar_dir"
  fi
fi

# ================================================================ L3 浏览器

L3_READY=0
L3_STEP=""

prepare_l3() {
  [ "$L3_READY" = "1" ] && return 0
  L3_STEP="SSH"
  ssh_run 'true' || return 1

  L3_EMAIL_A="e2e+p55l3a${STAMP}@kuaikan.test"
  L3_EMAIL_B="e2e+p55l3b${STAMP}@kuaikan.test"
  L3_NICK_A="e2e-p55l3a-${STAMP}"
  L3_NICK_B="e2e-p55l3b-${STAMP}"
  L3_COMMUNITY="e2e-p55-l3-${STAMP}"

  L3_STEP="建测试账号"
  L3_A_ID=$(mk_user "$L3_EMAIL_A" "$L3_NICK_A")
  L3_B_ID=$(mk_user "$L3_EMAIL_B" "$L3_NICK_B")
  [ -n "$L3_A_ID" ] && [ -n "$L3_B_ID" ] || return 1
  CLEANUP_NEEDED=1

  L3_STEP="账号登录"
  L3_TA=$(login_token "$L3_EMAIL_A" "$FIXTURE_PASS")
  L3_TB=$(login_token "$L3_EMAIL_B" "$FIXTURE_PASS")
  [ -n "$L3_TA" ] && [ -n "$L3_TB" ] || return 1

  L3_STEP="建社群"
  L3_COMMUNITY_ID=$(create_community "$L3_TA" "$L3_COMMUNITY")
  [ -n "$L3_COMMUNITY_ID" ] || return 1
  join_community "$L3_TB" "$L3_COMMUNITY"

  L3_STEP="发帖"
  L3_POST_TITLE="e2e P5.5 正常帖 ${STAMP}"
  L3_DELETED_TITLE="e2e P5.5 已删帖 ${STAMP}"
  L3_POST_ID=$(create_post "$L3_TB" "$L3_COMMUNITY_ID" "$L3_POST_TITLE")
  L3_DELETED_ID=$(create_post "$L3_TB" "$L3_COMMUNITY_ID" "$L3_DELETED_TITLE")
  [ -n "$L3_POST_ID" ] && [ -n "$L3_DELETED_ID" ] || return 1

  L3_STEP="收藏 + 制造已删帖"
  # 先收藏，再把帖子标记为已删（没有删帖接口，直接改 status 就是产品里的"已删帖"）
  favorite_post "$L3_TA" "$L3_POST_ID"
  favorite_post "$L3_TA" "$L3_DELETED_ID"
  sql_exec "UPDATE kuaikan_content.t_post SET status = 0 WHERE id = $L3_DELETED_ID;" >/dev/null

  # B 关注 A：让游客看到的「关注」Tab 非空（也顺便验证关注列表的真实渲染）
  api_post "$SITE/api/user/users/$L3_A_ID/follow" "$L3_TB" '{}' >/dev/null

  info "L3 夹具：A=$L3_A_ID B=$L3_B_ID 社群=$L3_COMMUNITY_ID 帖=$L3_POST_ID 已删=$L3_DELETED_ID"
  L3_STEP=""
  L3_READY=1
  return 0
}

if want_browser_layer; then
  section "L3 浏览器（playwright）"

  if [ -d "$WEB_DIR/node_modules" ] && command -v node >/dev/null 2>&1; then
    if ! prepare_l3; then
      ng "创建 L3 夹具失败" "失败在：${L3_STEP:-未知}"
    else
      if out=$(cd "$WEB_DIR" && SITE="$SITE" \
            E2E_EMAIL_A="$L3_EMAIL_A" E2E_EMAIL_B="$L3_EMAIL_B" \
            E2E_PASSWORD_A="$FIXTURE_PASS" E2E_PASSWORD_B="$FIXTURE_PASS" \
            E2E_NEW_PASSWORD_A="$FIXTURE_NEW_PASS" \
            E2E_NICK_A="$L3_NICK_A" E2E_NICK_B="$L3_NICK_B" \
            E2E_USER_ID_A="$L3_A_ID" E2E_USER_ID_B="$L3_B_ID" \
            E2E_COMMUNITY="$L3_COMMUNITY" E2E_POST_ID="$L3_POST_ID" \
            E2E_POST_TITLE="$L3_POST_TITLE" E2E_DELETED_TITLE="$L3_DELETED_TITLE" \
            npm run e2e:p55 2>&1); then
        printf '%s\n' "$out" | grep -E '^  (✓|✗)'
        n=$(printf '%s\n' "$out" | grep -c '^  ✓')
        PASS=$((PASS + n))
      else
        printf '%s\n' "$out" | grep -E '^  (✓|✗)'
        n_ok=$(printf '%s\n' "$out" | grep -c '^  ✓')
        PASS=$((PASS + n_ok))
        ng "浏览器验收有失败" "$(printf '%s\n' "$out" | grep '^  ✗' | head -3 | tr '\n' ' ')"
      fi
    fi
  else
    skip "L3 浏览器" "缺少 web/node_modules 或 node"
  fi
fi

# ================================================================ L4 清理核验

if want_layer l4; then
  section "L4 清理核验"

  pre_users=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user
      WHERE email LIKE 'e2e+p55%@kuaikan.test';" | tr -d '\r\n ')
  pre_ids=$(sql_exec "SELECT IFNULL(GROUP_CONCAT(id), 0) FROM kuaikan_user.t_user
      WHERE email LIKE 'e2e+p55%@kuaikan.test';" | tr -d '\r\n ')
  [ -z "$pre_ids" ] && pre_ids=0

  if [ "${pre_users:-0}" -gt 0 ] 2>/dev/null; then
    # 先证明"清理前确实有东西可清"，否则后面的 0 可能是空断言
    pre_keys=$(redis_exec "for uid in $(printf '%s' "$pre_ids" | tr ',' ' '); do
      redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZCARD \"auth:user:\$uid:access\"
    done" | tr -d '\r' | awk '{s+=$1} END{print s+0}')
    [ "${pre_keys:-0}" -gt 0 ] 2>/dev/null \
      && ok "清理前确有 ${pre_users} 个测试账号与 ${pre_keys} 条 access 会话" \
      || ng "清理前的会话键为 0（夹具或登录流程有问题）" "users=$pre_users keys=${pre_keys:-0}"
  else
    skip "清理前的测试数据" "本次运行没有创建夹具（单独跑 L4）"
  fi

  # 置位必须在 cleanup 之前：Redis 清理由这个标记控制，
  # 单独跑 L4 时如果先清理再置位，access 索引会被留在 Redis 里。
  CLEANUP_NEEDED=1
  cleanup
  sleep 1

  ids="$P55_IDS"
  [ -z "$ids" ] && ids=0

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user
      WHERE email LIKE 'e2e+p55%@kuaikan.test';" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "测试账号已全部删除" || ng "残留测试账号" "${n:-空} 行"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_refresh_token
      WHERE user_id IN ($ids);" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "refresh 行已清理" || ng "残留 refresh 行" "${n:-空}"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user_follow
      WHERE follower_id IN ($ids) OR followee_id IN ($ids);" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "关注关系已清理" || ng "残留关注关系" "${n:-空}"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_notification.t_message
      WHERE user_id IN ($ids) OR actor_id IN ($ids);" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "关注消息已清理" || ng "残留消息" "${n:-空}"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_interaction.t_interaction
      WHERE user_id IN ($ids) AND kind = 2;" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "收藏记录已清理" || ng "残留收藏" "${n:-空}"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post p
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p55%';" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "测试帖子已清理" || ng "残留帖子" "${n:-空}"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_community.t_community
      WHERE name LIKE 'e2e-p55%';" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "测试社群已清理" || ng "残留社群" "${n:-空}"

  n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_outbox
      WHERE topic = 'kuaikan_user_followed' AND payload LIKE '%e2e-p55%';" | tr -d '\r\n ')
  [ "${n:-1}" = "0" ] && ok "outbox 事件已清理" || ng "残留 outbox 事件" "${n:-空}"

  left=$(redis_exec "for uid in $(printf '%s' "$ids" | tr ',' ' '); do
      redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZCARD \"auth:user:\$uid:access\"
    done" | tr -d '\r' | awk '{s+=$1} END{print s+0}')
  [ "$ids" = "0" ] && left=0
  [ "${left:-1}" = "0" ] && ok "Redis 里的 access 索引已清空" || ng "残留 Redis 会话" "${left:-空}"

  # 线上首页：/latest 与社群列表都不该出现任何 e2e 残留
  latest=$(api_get "$SITE/api/content/posts/latest?limit=50")
  residue=$(printf '%s' "$latest" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data'] or []
except Exception: print('bad'); raise SystemExit(0)
bad=[p.get('title') for p in d if str(p.get('title') or '').startswith('e2e')]
print(';'.join(bad[:3]) if bad else 'none')" 2>/dev/null)
  [ "$residue" = "none" ] && ok "线上最新帖没有 e2e 残留" || ng "最新帖有 e2e 残留" "$residue"

  comms=$(api_get "$SITE/api/community/communities?limit=50")
  cres=$(printf '%s' "$comms" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data'] or {}
except Exception: print('bad'); raise SystemExit(0)
items=d.get('items') or []
bad=[c.get('name') for c in items if str(c.get('name') or '').startswith('e2e')]
print(';'.join(bad[:3]) if bad else 'none')" 2>/dev/null)
  [ "$cres" = "none" ] && ok "线上社群列表没有 e2e 残留" || ng "社群列表有 e2e 残留" "$cres"

  hc=$(http_code "$SITE/")
  [ "$hc" = "200" ] && ok "线上首页可访问（HTTP 200）" || ng "线上首页不可访问" "HTTP $hc"
fi

# ================================================================ 汇总

printf '\n%s汇总%s\n' "$B" "$N"
printf '  通过 %d   失败 %d   跳过 %d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s失败项：%s\n' "$R" "$N"
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  exit 1
fi
printf '  %sP5.5 验收通过%s\n' "$G" "$N"
