#!/usr/bin/env bash
# P5 排行验收。
#
#   ./deploy/bin/verify-p5.sh             全量（含 L6 回归：会递归跑 p0/p05/p1/p2/p3/p4）
#   ./deploy/bin/verify-p5.sh --fast      跳过 L6 回归与 L4 破坏性动作
#   ./deploy/bin/verify-p5.sh --layer l3  只跑某一层
#
# 顺序：L1 → L2 → L3 → L5 → L4（破坏性，必须最后）→ L6（最贵）。
#
# 断言纪律：
#   每个「应该是某个值」的断言，前面必须先证明"这个值能被观测到"。
#   否则空响应、404、零数据都会让断言恒绿——看起来全过其实什么都没测。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"
COMPOSE_ARGS=(-f /opt/kuaikan/repo/deploy/compose/compose.yml --profile core --profile app)

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
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
want_heavy_layer() {
  [ -z "$ONLY_LAYER_NORM" ] || [ "$ONLY_LAYER_NORM" = "$1" ] || return 1
  [ "$FAST" = "1" ] && return 1
  return 0
}

printf '%s%s%s\n' "$B" "kuaikan · P5 验收" "$N"
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
  ssh_run "echo '$b64' | base64 -d > /tmp/p5-sql.sh
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p5-sql.sh 2>/dev/null
    rm -f /tmp/p5-sql.sh"
}

# 在 redis 容器里跑一条 redis-cli 命令（容器内已有 REDIS_PASSWORD）
redis_eval() {
  local b64
  b64=$(printf 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" %s\n' "$1" | base64 | tr -d '\n')
  # 脚本写在**宿主机**上，所以要 `sh -s` 从 stdin 喂给容器内的 sh。
  # 写成 `docker exec ... sh /tmp/p5-redis.sh` 会去找容器里的 /tmp——那里没有这个文件。
  ssh_run "echo '$b64' | base64 -d > /tmp/p5-redis.sh
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-redis-1 sh -s < /tmp/p5-redis.sh
    rm -f /tmp/p5-redis.sh"
}

# 直接打某个服务的内网端口（用于内部端点）
svc() {  # $1=容器名 $2=端口 $3=curl 参数...
  local container="$1" port="$2"; shift 2
  ssh_run "docker exec $container curl -s --max-time 20 $* " 
}

trigger_rebuild() {
  svc kuaikan-rank-service-1 8087 "-X POST http://127.0.0.1:8087/internal/admin/rebuild"
}

# ================================================================ L1 契约与构建

if want_layer l1; then
  section "L1 契约与构建"

  out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1) \
    && ok "错误码契约三方一致" || ng "错误码契约不一致" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"
  out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1) \
    && ok "OpenAPI 与网关放行规则一致" || ng "OpenAPI 与放行规则不一致" "$(printf '%s' "$out" | sed -n '2p')"
  out=$(node "$APP_DIR/deploy/bin/check-scripts.mjs" 2>&1) \
    && ok "shell 脚本静态检查通过" || ng "shell 脚本静态检查" "$(printf '%s' "$out" | sed -n '2p')"

  # P5.0 的三列两索引。少任何一列，候选查询或热度公式都会静默少算
  cols=$(sql_exec "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY COLUMN_NAME)
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='kuaikan_content' AND TABLE_NAME='t_post'
        AND COLUMN_NAME IN ('view_count','share_count','last_interaction_at');" | tr -d '\r\n ')
  [ "$cols" = "last_interaction_at,share_count,view_count" ] \
    && ok "t_post 有三个热度列" || ng "t_post 缺热度列" "实得 ${cols:-空}"

  idx=$(sql_exec "SELECT GROUP_CONCAT(DISTINCT INDEX_NAME ORDER BY INDEX_NAME)
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='kuaikan_content' AND TABLE_NAME='t_post'
        AND INDEX_NAME IN ('idx_status_created','idx_status_last_interaction');" | tr -d '\r\n ')
  [ "$idx" = "idx_status_created,idx_status_last_interaction" ] \
    && ok "t_post 有两个候选查询索引" || ng "候选查询索引不全" "实得 ${idx:-空}"

  widx=$(sql_exec "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA='kuaikan_interaction' AND TABLE_NAME='t_interaction'
        AND INDEX_NAME='idx_kind_type_created';" | tr -d '\r\n ')
  [ "$widx" = "1" ] && ok "interaction 有窗口聚合索引" || ng "缺 idx_kind_type_created"

  # 消费组必须唯一：同 group 是集群消费（各拿一半），而且不报错
  if grep -q 'kuaikan-notification-' "$APP_DIR/services/notification-service/src/main/resources/application.yml"; then
    ok "notification 消费组命名保留（P4 回归由 L6 覆盖）"
  else
    ng "notification 消费组配置缺失"
  fi

  if [ -d "$WEB_DIR/node_modules" ]; then
    ( cd "$WEB_DIR" && npm run gen:types >/dev/null 2>&1 )
    drift=$(cd "$APP_DIR" && git status --porcelain -- web/src/shared/api/types 2>/dev/null)
    [ -z "$drift" ] && ok "前端类型无漂移" || ng "前端类型有漂移" "$(printf '%s' "$drift" | head -2 | tr '\n' ' ')"
    ( cd "$WEB_DIR" && npm run typecheck >/dev/null 2>&1 ) && ok "typecheck 通过" || ng "typecheck 失败"
  else
    skip "前端类型/typecheck" "缺少 web/node_modules"
  fi
fi

# ================================================================ 夹具

FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
EMAIL="e2e+p5${STAMP}@kuaikan.test"
EMAIL2="e2e+p5b${STAMP}@kuaikan.test"
USER_ID=""; USER_ID2=""
COMMUNITY_ID=""; COMMUNITY_NAME="e2e-p5-${STAMP}"
POST_ID=""; POST_ID2=""
TOKEN=""; TOKEN2=""
FIXTURE_READY=0
FIXTURE_STEP=""

cleanup() {
  if [ -n "$USER_ID" ]; then
    out=$(sql_exec "USE kuaikan_content;
      DELETE c FROM t_comment c JOIN t_post p ON p.id = c.post_id
        JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-%' OR co.id = ${COMMUNITY_ID:-0};
      DELETE p FROM t_post p JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-%' OR co.id = ${COMMUNITY_ID:-0};
      USE kuaikan_community;
      DELETE m FROM t_community_member m JOIN t_community c ON c.id = m.community_id
        WHERE c.name LIKE 'e2e-%' OR c.id = ${COMMUNITY_ID:-0};
      DELETE FROM t_community WHERE name LIKE 'e2e-%' OR id = ${COMMUNITY_ID:-0};
      DELETE FROM kuaikan_user.t_refresh_token WHERE user_id IN ($USER_ID, ${USER_ID2:-0});
      DELETE FROM kuaikan_user.t_user WHERE id IN ($USER_ID, ${USER_ID2:-0});
      DELETE FROM kuaikan_user.t_refresh_token
        WHERE user_id IN (SELECT id FROM kuaikan_user.t_user
                          WHERE email LIKE 'e2e+%' AND created_at < NOW() - INTERVAL 1 HOUR);
      DELETE FROM kuaikan_user.t_user
        WHERE email LIKE 'e2e+%' AND created_at < NOW() - INTERVAL 1 HOUR;
      DELETE c FROM kuaikan_content.t_comment c JOIN kuaikan_content.t_post p ON p.id = c.post_id
        LEFT JOIN kuaikan_community.t_community co ON co.id = p.community_id WHERE co.id IS NULL;
      DELETE p FROM kuaikan_content.t_post p
        LEFT JOIN kuaikan_community.t_community co ON co.id = p.community_id WHERE co.id IS NULL;
      DELETE FROM kuaikan_interaction.t_interaction
        WHERE (target_type = 1 AND target_id NOT IN (SELECT id FROM kuaikan_content.t_post))
           OR (target_type = 2 AND target_id NOT IN (SELECT id FROM kuaikan_content.t_comment));" 2>&1)
    case "$out" in
      *ERROR*) printf '  %s清理失败%s %s\n' "$R" "$N" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')" ;;
      *) info "已清理测试账号、社群、帖子" ;;
    esac
  fi
}
trap cleanup EXIT

prepare_fixture() {
  [ "$FIXTURE_READY" = "1" ] && return 0
  FIXTURE_STEP="SSH"
  ssh_run 'true' || return 1
  FIXTURE_STEP="建测试账号"
  out=$(sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL', '$FIXTURE_HASH', 'e2e-p5', 'USER', 1),
             (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL2', '$FIXTURE_HASH', 'e2e-p5b', 'USER', 1);
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL';
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL2';")
  USER_ID=$(printf '%s' "$out" | sed -n '1p' | tr -d '\r\n ')
  USER_ID2=$(printf '%s' "$out" | sed -n '2p' | tr -d '\r\n ')
  [ -n "$USER_ID" ] && [ -n "$USER_ID2" ] || return 1

  FIXTURE_STEP="账号登录"
  TOKEN=$(curl -s --max-time 15 -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}" | json_field 'data.accessToken')
  TOKEN2=$(curl -s --max-time 15 -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL2\",\"password\":\"$FIXTURE_PASS\"}" | json_field 'data.accessToken')
  [ -n "$TOKEN" ] && [ -n "$TOKEN2" ] || return 1

  FIXTURE_STEP="建社群"
  COMMUNITY_ID=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$COMMUNITY_NAME\"}" | json_field 'data.id')
  [ -n "$COMMUNITY_ID" ] || return 1

  curl -s --max-time 15 -o /dev/null -X POST \
    "$SITE/api/community/communities/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$COMMUNITY_NAME")/membership" \
    -H "Authorization: Bearer $TOKEN2"

  FIXTURE_STEP="发帖"
  POST_ID=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"communityId\":\"$COMMUNITY_ID\",\"title\":\"e2e P5 帖 A\",\"body\":\"x\"}" | json_field 'data.id')
  POST_ID2=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"communityId\":\"$COMMUNITY_ID\",\"title\":\"e2e P5 帖 B\",\"body\":\"x\"}" | json_field 'data.id')
  [ -n "$POST_ID" ] && [ -n "$POST_ID2" ] || return 1

  info "夹具：community=$COMMUNITY_ID  postA=$POST_ID  postB=$POST_ID2"
  FIXTURE_STEP=""
  FIXTURE_READY=1
  return 0
}

post_field() {  # $1=postId $2=字段
  curl -s --max-time 10 "$SITE/api/content/posts/$1" | json_field "data.$2"
}

unread_ok() { [ -n "$(curl -s --max-time 10 "$SITE/api/rank/hot?range=day" | json_field 'data.total')" ]; }

# ================================================================ L2 计数

if want_layer l2; then
  section "L2 新增计数"

  if ! prepare_fixture; then
    ng "创建夹具失败" "失败在：${FIXTURE_STEP:-未知}"
  else
    # ① 浏览：Redis 立刻加，MySQL 最多滞后 60 秒
    before=$(post_field "$POST_ID" viewCount)
    curl -s --max-time 10 -o /dev/null "$SITE/api/content/posts/$POST_ID"
    curl -s --max-time 10 -o /dev/null "$SITE/api/content/posts/$POST_ID"
    rc=$(redis_eval "GET view:post:$POST_ID")
    [ "${rc:-0}" -ge 1 ] 2>/dev/null \
      && ok "浏览后 Redis 计数立刻增加（${rc}）" || ng "Redis 浏览量计数没有增加" "实得 ${rc:-空}"

    dirty=$(redis_eval "SISMEMBER view:dirty $POST_ID")
    [ "$dirty" = "1" ] && ok "帖子进入待回写集合" || ng "帖子没进 view:dirty"

    # 回写是 60 秒一次的定时任务，最多等 90 秒
    flushed=""
    for _ in $(seq 1 30); do
      sleep 3
      now=$(post_field "$POST_ID" viewCount)
      if [ "${now:-0}" -gt "${before:-0}" ] 2>/dev/null; then flushed="$now"; break; fi
    done
    [ -n "$flushed" ] && ok "60 秒内回写到 MySQL（viewCount ${before} → ${flushed}）" \
      || ng "浏览量没有回写到 MySQL" "仍为 $(post_field "$POST_ID" viewCount)"

    # ② 分享：立即 +1
    s0=$(post_field "$POST_ID" shareCount)
    s1=$(curl -s --max-time 10 -X POST "$SITE/api/content/posts/$POST_ID/share" | json_field 'data')
    [ "${s1:-0}" -gt "${s0:-0}" ] 2>/dev/null \
      && ok "分享计数立即增加（${s0} → ${s1}）" || ng "分享计数没有增加" "实得 ${s1:-空}"

    # ③ last_interaction_at：评论后同事务更新
    li_before=$(sql_exec "SELECT IFNULL(last_interaction_at,'NULL') FROM kuaikan_content.t_post WHERE id=$POST_ID" | tr -d '\r\n ')
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/content/posts/$POST_ID/comments" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d '{"body":"e2e 热度用评论"}'
    li_after=$(sql_exec "SELECT IFNULL(last_interaction_at,'NULL') FROM kuaikan_content.t_post WHERE id=$POST_ID" | tr -d '\r\n ')
    [ "$li_after" != "NULL" ] && [ "$li_after" != "$li_before" ] \
      && ok "评论后 last_interaction_at 被更新" || ng "last_interaction_at 没更新" "$li_before → $li_after"

    # ④ 点赞也刷新（跨服务：interaction 发事件，content 消费后更新）
    drop_like() {
      curl -s --max-time 15 -o /dev/null -X DELETE \
        "$SITE/api/interaction/likes?targetType=post&targetId=$1" -H "Authorization: Bearer $2"
    }
    drop_like "$POST_ID" "$TOKEN2"
    sleep 6
    li_prev="$li_after"
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/interaction/likes" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d "{\"targetType\":\"post\",\"targetId\":\"$POST_ID\"}"
    li_now=""
    for _ in $(seq 1 20); do
      sleep 1
      li_now=$(sql_exec "SELECT IFNULL(last_interaction_at,'NULL') FROM kuaikan_content.t_post WHERE id=$POST_ID" | tr -d '\r\n ')
      [ "$li_now" != "$li_prev" ] && [ "$li_now" != "NULL" ] && break
    done
    [ "$li_now" != "$li_prev" ] && [ "$li_now" != "NULL" ] \
      && ok "点赞事件消费后 last_interaction_at 被刷新" || ng "点赞没有刷新 last_interaction_at"
  fi
fi

# ================================================================ L3 重建与读取一致性

if want_layer l3; then
  section "L3 重建与读取一致性"

  out=$(trigger_rebuild)
  d=$(printf '%s' "$out" | json_field 'data.day')
  w=$(printf '%s' "$out" | json_field 'data.week')
  [ "$d" = "True" ] && [ "$w" = "True" ] \
    && ok "内部重建端点：日榜与周榜都成功" || ng "重建失败" "day=$d week=$w"

  cur=$(redis_eval "GET rank:hot:day:current")
  [ -n "$cur" ] && ok "current 指针存在（version=${cur}）" || ng "current 指针不存在"
  zcard=$(redis_eval "ZCARD rank:hot:day:v$cur")
  hlen=$(redis_eval "HLEN rank:hot:day:meta:v$cur")
  [ "${zcard:-0}" -gt 0 ] 2>/dev/null && ok "ZSet 有 $zcard 条" || ng "ZSet 为空"
  [ "$zcard" = "$hlen" ] && ok "ZSet 与 meta 条数一致（${zcard}）" \
    || ng "ZSet($zcard) 与 meta($hlen) 条数不一致"

  ttl=$(redis_eval "TTL rank:hot:day:v$cur")
  [ "${ttl:-0}" -gt 0 ] 2>/dev/null && ok "新版本 key 带 TTL（${ttl}s），旧版本会自然过期" \
    || ng "新版本 key 没有 TTL"

  # 分数与顺序：ZREVRANGE 必须严格递减
  order=$(redis_eval "ZREVRANGE rank:hot:day:v$cur 0 -1 WITHSCORES")
  if printf '%s' "$order" | python3 -c "
import sys
lines=[l.strip() for l in sys.stdin if l.strip()]
scores=[float(x) for x in lines[1::2]]
print('ok' if all(scores[i] >= scores[i+1] for i in range(len(scores)-1)) else 'bad')
" | grep -q ok; then
    ok "ZSet 内分数严格非递增"
  else
    ng "ZSet 内分数顺序不对"
  fi

  # 切换的原子性：重建期间并发读，**任何一条都不能缺标题**
  # 这正是版本化要解决的问题——RENAME 两个 key 之间会出现"新分数配旧标题"
  trigger_rebuild >/dev/null 2>&1 &
  # 每个并发请求写**自己的文件**，不能共用一个管道：
  # 10 个进程往同一个管道写，单次输出超过 PIPE_BUF(4096) 时会交错，
  # 拼出来的 JSON 必然解析失败——那是假红，不是产品的原子性问题。
  probe_dir=$(mktemp -d)
  trigger_rebuild >/dev/null 2>&1 &
  seq 1 50 | xargs -P 10 -I{} sh -c "curl -s --max-time 10 '$SITE/api/rank/hot?range=day' -o '$probe_dir/{}.json' 2>/dev/null || true"
  wait
  bad=$(python3 - "$probe_dir" <<'PYEOF'
import glob, json, os, sys
bad = 0
files = glob.glob(os.path.join(sys.argv[1], "*.json"))
for f in files:
    raw = open(f, encoding="utf-8", errors="replace").read()
    if not raw.strip():
        bad += 1
        continue
    try:
        d = json.loads(raw)
    except Exception:
        bad += 1
        continue
    if d.get("code") != 0:
        bad += 1
        continue
    for it in (d.get("data") or {}).get("items") or []:
        if not it.get("title") or not it.get("postId"):
            bad += 1
            break
if len(files) < 50:
    bad += 50 - len(files)
print(bad)
PYEOF
)
  rm -rf "$probe_dir"
  [ "${bad:-1}" = "0" ] && ok "重建期间 50 次并发读，0 条缺标题（切换原子）" \
    || ng "重建期间读到了不完整的条目" "${bad} 处"

  # 未登录可读
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/rank/hot?range=week")
  [ "$code" = "200" ] && ok "热榜游客可读（200）" || ng "热榜游客读不到" "HTTP $code"

  # 非法 range 明确拒绝
  msg=$(curl -s --max-time 10 "$SITE/api/rank/hot?range=month")
  printf '%s' "$msg" | grep -q '40010' && ok "非法 range 返回 40010" || ng "非法 range 未被拒绝"
fi

# ================================================================ L5 评论排序

if want_layer l5; then
  # 用 postB 而不是 postA：L2 已经在 postA 上发过一条评论，
  # 而这一层要断言"先发的那条排第一"——共用同一个帖子会让它不成立。
  # 这是 P4 的 L4 踩过的同一个坑：各层共用夹具（FIXTURE_READY 是全局的）。
  section "L5 评论排序"

  if ! prepare_fixture; then
    ng "创建夹具失败" "失败在：${FIXTURE_STEP:-未知}"
  else
    # 造两条评论：B 有回复（热度 1），A 没有（热度 0）
    c1=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts/$POST_ID2/comments" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d '{"body":"e2e 先发的评论"}' | json_field 'data.id')
    c2=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts/$POST_ID2/comments" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d '{"body":"e2e 后发的评论"}' | json_field 'data.id')
    [ -n "$c1" ] && [ -n "$c2" ] || ng "评论创建失败"
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/content/posts/$POST_ID2/comments" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"replyToCommentId\":\"$c1\",\"body\":\"e2e 给先发的回复\"}"

    time_first=$(curl -s --max-time 10 "$SITE/api/content/posts/$POST_ID2/comments?limit=20" \
      | json_field 'data.items.0.id')
    [ "$time_first" = "$c1" ] && ok "默认仍是时间序（先发的在前）" \
      || ng "默认排序被改动了" "首条=$time_first 期望 $c1"

    hot_first=$(curl -s --max-time 10 "$SITE/api/content/posts/$POST_ID2/comments?sort=hot&limit=20" \
      | json_field 'data.items.0.id')
    [ "$hot_first" = "$c1" ] && ok "sort=hot：有回复的排前面" \
      || ng "热度序没生效" "首条=$hot_first"

    bad=$(curl -s --max-time 10 "$SITE/api/content/posts/$POST_ID2/comments?sort=new")
    printf '%s' "$bad" | grep -q '40010' && ok "非法 sort 返回 40010" || ng "非法 sort 未被拒绝"

    # 跨排序复用游标必须被拒绝：三段游标喂给四段的分数序接口
    tc=$(curl -s --max-time 10 "$SITE/api/content/posts/$POST_ID2/comments?limit=1" | json_field 'data.nextCursor')
    if [ -n "$tc" ]; then
      enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$tc")
      cross=$(curl -s --max-time 10 "$SITE/api/content/posts/$POST_ID2/comments?sort=hot&limit=1&cursor=$enc")
      printf '%s' "$cross" | grep -q '40010' && ok "跨排序复用游标被拒绝（40010）" \
        || ng "跨排序游标被接受了"
    else
      skip "跨排序游标" "这一页没有 nextCursor"
    fi
  fi
fi

# ================================================================ L4 破坏性（必须最后）

if want_heavy_layer l4; then
  section "L4 破坏性动作"

  cur_before=$(redis_eval "GET rank:hot:day:current")
  total_before=$(curl -s --max-time 10 "$SITE/api/rank/hot?range=day" | json_field 'data.total')

  # ① content 停机 → 重建失败 → 榜单必须保留上一版
  ssh_run "set -a; . $ENV_FILE; set +a; docker compose ${COMPOSE_ARGS[*]} stop content-service" >/dev/null
  sleep 3
  result=$(trigger_rebuild)
  dres=$(printf '%s' "$result" | json_field 'data.day')
  [ "$dres" = "False" ] && ok "content 停机时重建返回失败（不抛 500）" || ng "重建没有正确报告失败" "day=$dres"
  cur_after=$(redis_eval "GET rank:hot:day:current")
  [ "$cur_before" = "$cur_after" ] && ok "失败时 current 未被改动" || ng "失败却切换了版本"
  total_after=$(curl -s --max-time 10 "$SITE/api/rank/hot?range=day" | json_field 'data.total')
  [ "$total_after" = "$total_before" ] && ok "榜单保留上一版（${total_after} 条）" \
    || ng "榜单被清空了" "${total_before} → ${total_after}"

  ssh_run "set -a; . $ENV_FILE; set +a; docker compose ${COMPOSE_ARGS[*]} start content-service" >/dev/null
  info "content-service 已恢复"

  # ② 删光 Redis 的榜 → 定时任务（5 分钟）内自动重建
  wiped=$(redis_eval "--scan --pattern 'rank:hot:*'" | wc -l | tr -d ' ')
  ssh_run "set -a; . $ENV_FILE; set +a
    docker exec kuaikan-redis-1 sh -c 'redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" --scan --pattern \"rank:hot:*\" | xargs -r redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" del'" >/dev/null
  after_wipe=$(curl -s --max-time 10 "$SITE/api/rank/hot?range=day" | json_field 'data.total')
  [ "$after_wipe" = "0" ] && ok "删光后榜为空（没有残留）" || ng "删光后仍有数据" "$after_wipe"

  info "等定时任务重建（最多 5.5 分钟）…"
  restored=""
  for _ in $(seq 1 66); do
    sleep 5
    n=$(curl -s --max-time 10 "$SITE/api/rank/hot?range=day" | json_field 'data.total')
    if [ "${n:-0}" -gt 0 ] 2>/dev/null; then restored="$n"; break; fi
  done
  [ -n "$restored" ] && ok "5 分钟内自动重建回来（${wiped} 个 key 被删，恢复 ${restored} 条）" \
    || ng "删光后没有自动重建"
fi

# ================================================================ L6 回归

if want_heavy_layer l6; then
  section "L6 回归（P0 / P0.5 / P1 / P2 / P3 / P4）"

  out=$(ssh_run 'cd /opt/kuaikan/repo && git fetch -q origin && git reset -q --hard origin/main \
    && bash deploy/bin/verify.sh --no-restart --skip-log-check' 2>&1)
  printf '%s' "$out" | grep -q 'P0 验收通过' && ok "verify.sh（P0）全绿" \
    || ng "verify.sh（P0）有失败" "$(printf '%s' "$out" | tail -1)"

  for script in verify-p05.sh verify-p1.sh verify-p2.sh verify-p3.sh verify-p4.sh; do
    child_log="/tmp/kuaikan-p5-l6-${script%.sh}.log"
    if bash "$APP_DIR/deploy/bin/$script" --fast >"$child_log" 2>&1; then
      ok "$script 全绿"
    else
      detail=$(grep -E '^ *✗' "$child_log" | head -3 | sed 's/^ *//' | tr '\n' ';')
      ng "$script 有失败" "${detail:-详见 $child_log}"
    fi
  done
fi

# ================================================================ 汇总

printf '\n%s汇总%s\n' "$B" "$N"
printf '  通过 %d   失败 %d   跳过 %d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s失败项：%s\n' "$R" "$N"
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  exit 1
fi
printf '  %sP5 验收通过%s\n' "$G" "$N"
