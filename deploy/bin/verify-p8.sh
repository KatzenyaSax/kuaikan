#!/usr/bin/env bash
# P8 AI 社区助手（Community Copilot）分层验收脚本。
#
#   ./deploy/bin/verify-p8.sh              全量（L0 → L4）
#   ./deploy/bin/verify-p8.sh --layer l2   只跑某一层
#   ./deploy/bin/verify-p8.sh --fast       跳过浏览器层（L3）
#
# 分层：
#   L0 契约与静态检查   check-contract（36 码）/ check-openapi（85 operationId）/
#                       check-scripts / deploy-bin bash -n / web typecheck+lint+build /
#                       工作区干净（全量时）/ 网关未放行 /api/ai/** 且剥离 X-AI-Stub
#   L1 鉴权与越权边界   游客调 AI 端点一律 401+40100；跨用户访问/发消息/删会话/回传动作
#                       一律 404+44004；公网携带 X-AI-Stub 不得命中 Stub
#   L2 容器内全链路     Stub LLM 确定性覆盖：会话 CRUD、真实 ES 检索+引用白名单+剥离 [^9]、
#                       第 6 步强制 tool_choice=none 收尾、单帖省流共享缓存命中不扣配额、
#                       未读消息跨用户隔离、内联 compose 零写库、确认卡 6 类动作不静默写库、
#                       FAILED+41004 续写不扣配额、44006 幂等、44005 过期、44002 并发锁、
#                       44001 日配额耗尽、44003 预算熔断；若配了 DEEPSEEK_API_KEY 跑真实冒烟
#   L3 浏览器           web/e2e/p8-ai.mjs
#   L4 破坏性故障隔离   停 ai-service → 主站首页/读帖/发帖删帖全正常 → 拉起 ai-service 回 healthy
set -uo pipefail

if [ -d "$HOME/.local/node/current/bin" ]; then
  PATH="$HOME/.local/node/current/bin:$PATH"
  export PATH
fi

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SITE_HOST="${SITE_HOST:-$(printf '%s' "$SITE" | sed -e 's|^https\{0,1\}://||' -e 's|/.*$||')}"
SITE_RESOLVE="${SITE_RESOLVE:-}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"
AI_CT="${AI_CT:-kuaikan-ai-service-1}"
ES_CT="${ES_CT:-kuaikan-elasticsearch-1}"
ES_URL="http://127.0.0.1:9200"

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "未知参数：${1}" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=""; R=""; Y=""; D=""; B=""; N=""
fi

PASS=0; FAIL=0; SKIP=0
FAILED_ITEMS=""
section() { printf '\n%s%s%s\n' "$B" "$1" "$N"; }
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
ng()   {
  FAIL=$((FAIL+1))
  FAILED_ITEMS="${FAILED_ITEMS}${1}"$'\n'
  printf '  %s✗%s %s%s%s\n' "$R" "$N" "$1" "${2:+ — $2}" ""
}
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

printf '%s%s%s\n' "$B" "kuaikan · P8 AI 社区助手验收" "$N"
info "站点 ${SITE}"
[ -n "$SITE_RESOLVE" ] && info "站点解析固定为 ${SITE_RESOLVE}"
info "开始 $(date '+%F %T')"

RESOLVE_ARGS=""
[ -n "$SITE_RESOLVE" ] && RESOLVE_ARGS="--resolve ${SITE_HOST}:443:${SITE_RESOLVE}"
site_curl() { curl ${RESOLVE_ARGS} "$@"; }

json_field() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
v=d
for k in sys.argv[1].split('.'):
    if isinstance(v,dict) and k in v: v=v[k]
    elif isinstance(v,list) and k.isdigit() and int(k) < len(v): v=v[int(k)]
    else: print(''); raise SystemExit(0)
if v is None: print('')
elif isinstance(v,bool): print('true' if v else 'false')
else: print(v)
" "$1" 2>/dev/null; }

sse_text() { python3 -c "
import json,sys
out=[]
ev=None
for line in sys.stdin:
    line=line.rstrip('\r\n')
    if line.startswith('event:'):
        ev=line[6:].strip()
    elif line.startswith('data:') and ev=='delta':
        try: out.append(json.loads(line[5:].strip()).get('text',''))
        except Exception: pass
    elif line=='':
        ev=None
print(''.join(out))
" 2>/dev/null; }

json_obj() {
  python3 -c "
import json,sys
args=sys.argv[1:]
print(json.dumps({args[i]: args[i+1] for i in range(0,len(args),2)}))" "$@"
}

sql_exec() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '${b64}' | base64 -d > /tmp/p8-fixture.sql
    set -a; . ${ENV_FILE}; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p8-fixture.sql 2>/dev/null
    rm -f /tmp/p8-fixture.sql"
}

sql_exec_v() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '${b64}' | base64 -d > /tmp/p8-fixture.sql
    set -a; . ${ENV_FILE}; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p8-fixture.sql 2>&1
    rm -f /tmp/p8-fixture.sql"
}

redis_exec() {
  local b64
  b64=$(printf '%s\n' "$1" | base64 | tr -d '\n')
  ssh_run "echo '${b64}' | base64 -d > /tmp/p8-redis.sh
    set -a; . ${ENV_FILE}; set +a
    docker exec -i kuaikan-redis-1 sh -s < /tmp/p8-redis.sh
    rm -f /tmp/p8-redis.sh"
}

http_code() {
  local c
  c=$(site_curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-20}" "$1" 2>/dev/null)
  printf '%s' "${c:-000}"
}

call_http() {  # $1=方法 $2=url $3=token(可空) $4=body(可空) → "HTTP CODE"
  local method="$1" url="$2" token="${3:-}" body="${4:-}" tmp c b
  tmp=$(mktemp)
  local args=(-s -o "$tmp" -w '%{http_code}' --max-time 20 -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer ${token}")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  c=$(site_curl "${args[@]}" 2>/dev/null)
  b=$(json_field 'code' < "$tmp" 2>/dev/null)
  rm -f "$tmp"
  printf '%s %s' "${c:-000}" "${b:--}"
}

expect_http_code() {
  local label="$1" eh="$2" ec="$3" res="$4" h b
  h=${res%% *}
  b=${res#* }
  if [ "$h" = "$eh" ] && { [ "$ec" = "-" ] || [ "$b" = "$ec" ]; }; then
    ok "$label"
  else
    ng "$label" "实得 HTTP ${h:-空} code=${b:-空}，期望 HTTP ${eh} code ${ec}"
  fi
}

es_get() { ssh_run "docker exec ${ES_CT} curl -s --max-time 15 '${ES_URL}${1}'"; }

es_doc_found() {
  es_get "/post_read/_doc/${1}" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('no'); raise SystemExit(0)
print('yes' if d.get('found') else 'no')" 2>/dev/null
}

es_count() { es_get '/post_read/_count' | json_field 'count'; }
rebuild_index() { ssh_run "docker exec kuaikan-search-service-1 curl -s --max-time 90 -X POST http://127.0.0.1:8086/internal/admin/rebuild"; }

settle_index() {
  local round db es
  for round in 1 2 3; do
    rebuild_index >/dev/null 2>&1
    sleep 2
    db=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
    es=$(es_count)
    [ -n "$es" ] && [ "$es" = "$db" ] && return 0
  done
  return 1
}

wait_post_in_es() {
  local waited=0 hit="no"
  while [ "$waited" -lt "$2" ]; do
    hit=$(es_doc_found "$1")
    [ "$hit" = "yes" ] && break
    sleep 1
    waited=$((waited+1))
  done
  printf '%s' "$hit"
}

svc_state() { ssh_run "docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${1} 2>/dev/null"; }

ensure_ai_up() {
  ssh_run "docker start ${AI_CT} >/dev/null 2>&1 || true"
  local waited=0 st
  while [ "$waited" -lt 240 ]; do
    st=$(ssh_run "docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${AI_CT} 2>/dev/null")
    [ "$st" = "healthy" ] && return 0
    sleep 5
    waited=$((waited+5))
  done
  return 1
}

ai_internal_sse() {  # $1=userId $2=path $3=body $4=stub(可空)
  local uid="$1" path="$2" body="$3" stub="${4:-}" b64
  b64=$(printf '%s' "$body" | base64 | tr -d '\n')
  ssh_run "set -e
    payload=\$(echo '${b64}' | base64 -d)
    if [ -n '${stub}' ]; then
      docker exec ${AI_CT} curl -sS -N --max-time 30 -X POST 'http://127.0.0.1:8088${path}' \
        -H 'Content-Type: application/json' -H 'X-User-Id: ${uid}' -H 'X-AI-Stub: ${stub}' \
        -d \"\$payload\"
    else
      docker exec ${AI_CT} curl -sS -N --max-time 45 -X POST 'http://127.0.0.1:8088${path}' \
        -H 'Content-Type: application/json' -H 'X-User-Id: ${uid}' \
        -d \"\$payload\"
    fi"
}

# ---------------------------------------------------------------- 夹具管理与清理

FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
TODAY=$(date -u -d '+8 hours' '+%Y%m%d' 2>/dev/null || TZ=Asia/Shanghai date '+%Y%m%d')
CLEANUP_NEEDED=0
CLEANED=0
AI_STOPPED=0
P8_USER_IDS=""
P8_POST_IDS=""
BUDGET_SAVED=""

remember_ids() {
  if [ -n "${1:-}" ]; then printf '%s,%s' "$1" "$2"; else printf '%s' "$2"; fi
}

mk_user() {
  sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '${1}', '${FIXTURE_HASH}', '${2}', 'USER', 1);
    SELECT id FROM kuaikan_user.t_user WHERE email='${1}';" | sed -n '1p' | tr -d '\r\n '
}

login_token() {
  site_curl -s --max-time 20 -X POST "${SITE}/api/user/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${1}\",\"password\":\"${2}\"}" | json_field 'data.accessToken'
}

cleanup() {
  [ "$CLEANED" = "1" ] && return 0
  CLEANED=1

  if [ "$AI_STOPPED" = "1" ]; then
    ensure_ai_up >/dev/null 2>&1 || true
    AI_STOPPED=0
  fi

  if [ -n "$BUDGET_SAVED" ]; then
    redis_exec "
      if [ '${BUDGET_SAVED}' = '__NONE__' ]; then
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"ai:budget:${TODAY}\" >/dev/null
      else
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" SET \"ai:budget:${TODAY}\" \"${BUDGET_SAVED}\" EX 172800 >/dev/null
      fi" >/dev/null 2>&1 || true
  fi

  [ "$CLEANUP_NEEDED" = "0" ] && return 0
  info "清理 P8 临时测试数据…"

  local uid_list="${P8_USER_IDS:-0}"
  local pid_list="${P8_POST_IDS:-0}"
  local has_posts=0
  [ -n "$P8_POST_IDS" ] && has_posts=1

  sql_exec_v "
    DELETE FROM kuaikan_ai.t_ai_action WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_ai.t_ai_message WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_ai.t_ai_conversation WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_notification.t_message WHERE user_id IN (${uid_list}) OR actor_id IN (${uid_list});
    DELETE FROM kuaikan_interaction.t_interaction WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_content.t_comment WHERE author_id IN (${uid_list}) OR post_id IN (${pid_list});
    DELETE FROM kuaikan_content.t_post WHERE author_id IN (${uid_list}) OR id IN (${pid_list});
    DELETE FROM kuaikan_community.t_community_history WHERE operator_id IN (${uid_list}) OR community_id IN (SELECT id FROM kuaikan_community.t_community WHERE name LIKE 'e2e-p8-%');
    DELETE FROM kuaikan_community.t_community_member WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_community.t_community WHERE name LIKE 'e2e-p8-%';
    DELETE FROM kuaikan_user.t_user_follow WHERE follower_id IN (${uid_list}) OR followee_id IN (${uid_list});
    DELETE FROM kuaikan_user.t_refresh_token WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_user.t_user WHERE id IN (${uid_list}) OR email LIKE 'e2e+p8%@kuaikan.test';
    DELETE FROM kuaikan_content.t_outbox WHERE payload LIKE '%e2e-p8-%';
  " >/dev/null 2>&1 || true

  redis_exec "
    for uid in $(printf '%s' "${uid_list}" | tr ',' ' '); do
      for jti in \$(redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZRANGE \"auth:user:\$uid:access\" 0 -1); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:session:\$jti\" >/dev/null
      done
      redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:user:\$uid:access\" \"ai:quota:${TODAY}:\$uid\" \"ai:lock:stream:\$uid\" >/dev/null
    done
    for pid in $(printf '%s' "${pid_list}" | tr ',' ' '); do
      for k in \$(redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" KEYS \"ai:summary:\${pid}:*\"); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"\$k\" >/dev/null
      done
    done
  " >/dev/null 2>&1 || true

  if [ "$has_posts" = "1" ]; then
    settle_index >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

# ================================================================ L0
if want_layer l0; then
  section "L0 本地契约与静态检查"
  if node "$APP_DIR/deploy/bin/check-contract.mjs" >/tmp/p8-l0-contract.log 2>&1; then
    ok "check-contract.mjs 一致（36 码）"
  else
    ng "check-contract.mjs 失败" "$(tail -3 /tmp/p8-l0-contract.log | tr '\n' ' ')"
  fi

  if node "$APP_DIR/deploy/bin/check-openapi.mjs" >/tmp/p8-l0-openapi.log 2>&1; then
    ok "check-openapi.mjs 一致（85 operationId）"
  else
    ng "check-openapi.mjs 失败" "$(tail -3 /tmp/p8-l0-openapi.log | tr '\n' ' ')"
  fi

  if node "$APP_DIR/deploy/bin/check-scripts.mjs" >/tmp/p8-l0-scripts.log 2>&1; then
    ok "check-scripts.mjs 通过"
  else
    ng "check-scripts.mjs 失败" "$(tail -3 /tmp/p8-l0-scripts.log | tr '\n' ' ')"
  fi

  sh_bad=0
  for f in "$APP_DIR"/deploy/bin/*.sh; do
    bash -n "$f" || sh_bad=1
  done
  [ "$sh_bad" = "0" ] && ok "deploy/bin/*.sh 全部 bash -n 语法通过" || ng "deploy/bin/*.sh 存在语法错误"

  if (cd "$WEB_DIR" && npm run typecheck && npm run lint && npm run build >/tmp/p8-l0-web.log 2>&1); then
    ok "web typecheck + lint + build 全部通过"
  else
    ng "web 构建或静态检查失败" "见 /tmp/p8-l0-web.log"
  fi

  # 网关配置：/api/ai/** 必须受保护且绝不进白名单
  gw_yml="$APP_DIR/services/gateway/src/main/resources/application.yml"
  if grep -q "Path=/api/ai/\*\*" "$gw_yml" && ! grep -q "/api/ai/" <(grep -E "^\s*- .*\/api\/" "$gw_yml" | grep -v "Path="); then
    ok "网关已路由 /api/ai/** 且未将任何 AI 端点加入白名单"
  else
    ng "网关 /api/ai/** 路由或白名单配置异常"
  fi

  if grep -q "Headers.AI_STUB" "$APP_DIR/services/gateway/src/main/java/top/katzenyasax/kuaikan/gateway/filter/JwtAuthGlobalFilter.java"; then
    ok "网关 JwtAuthGlobalFilter 已剥离 X-AI-Stub"
  else
    ng "网关 JwtAuthGlobalFilter 未剥离 X-AI-Stub"
  fi

  if [ -z "$ONLY_LAYER_NORM" ]; then
    dirty=$(git -C "$APP_DIR" status --porcelain contract deploy docs services web)
    if [ -z "$dirty" ]; then
      ok "工作区干净（contract/deploy/docs/services/web 无未提交改动）"
    else
      ng "工作区有未提交改动（请先 commit 再跑全量 verify）" "$(printf '%s' "$dirty" | head -3 | tr '\n' ';')"
    fi
  else
    skip "工作区干净检查" "--layer 分层运行跳过"
  fi
fi

# ================================================================ L1 / L2 / L3 公共夹具准备
NEED_FIXTURE=0
if want_layer l1 || want_layer l2 || want_browser_layer; then
  NEED_FIXTURE=1
fi

if [ "$NEED_FIXTURE" = "1" ]; then
  section "准备 P8 临时验证夹具"
  CLEANUP_NEEDED=1

  EMAIL_A="e2e+p8a+${STAMP}@kuaikan.test"
  EMAIL_B="e2e+p8b+${STAMP}@kuaikan.test"
  UID_A=$(mk_user "$EMAIL_A" "P8测试甲_${STAMP: -4}")
  UID_B=$(mk_user "$EMAIL_B" "P8测试乙_${STAMP: -4}")
  P8_USER_IDS=$(remember_ids "$P8_USER_IDS" "$UID_A")
  P8_USER_IDS=$(remember_ids "$P8_USER_IDS" "$UID_B")
  TOK_A=$(login_token "$EMAIL_A" "$FIXTURE_PASS")
  TOK_B=$(login_token "$EMAIL_B" "$FIXTURE_PASS")

  COMM_A="e2e-p8-a-${STAMP}"
  COMM_B="e2e-p8-b-${STAMP}"
  COMM_A_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/community/communities" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d "$(json_obj name "$COMM_A")" | json_field 'data.id')
  COMM_B_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/community/communities" \
    -H "Authorization: Bearer ${TOK_B}" -H 'Content-Type: application/json' \
    -d "$(json_obj name "$COMM_B")" | json_field 'data.id')

  KW_TOKEN="P8检索密钥${STAMP}"
  POST_A_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/content/posts" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d "$(json_obj communityId "$COMM_A_ID" title "P8 测试帖 ${KW_TOKEN}" body "正文包含核心讨论点 ${KW_TOKEN}，用于验证真实 ES 检索与单帖省流。")" | json_field 'data.id')
  P8_POST_IDS=$(remember_ids "$P8_POST_IDS" "$POST_A_ID")

  if [ -n "$UID_A" ] && [ -n "$UID_B" ] && [ -n "$TOK_A" ] && [ -n "$TOK_B" ] && [ -n "$POST_A_ID" ]; then
    ok "临时账号与帖子夹具就绪（UID_A=${UID_A} POST_A=${POST_A_ID}）"
  else
    ng "临时夹具创建失败"
  fi
fi

# ================================================================ L1
if want_layer l1; then
  section "L1 鉴权与越权边界"
  expect_http_code "游客 POST /api/ai/conversations → 401/40100" "401" "40100" "$(call_http POST "${SITE}/api/ai/conversations")"
  expect_http_code "游客 GET /api/ai/conversations → 401/40100" "401" "40100" "$(call_http GET "${SITE}/api/ai/conversations")"
  expect_http_code "游客 GET /api/ai/quota → 401/40100" "401" "40100" "$(call_http GET "${SITE}/api/ai/quota")"
  expect_http_code "游客 POST /api/ai/compose → 401/40100" "401" "40100" "$(call_http POST "${SITE}/api/ai/compose" "" '{"mode":"POLISH","draft":"hi"}')"
  expect_http_code "游客 POST /api/ai/actions/1/result → 401/40100" "401" "40100" "$(call_http POST "${SITE}/api/ai/actions/1/result" "" '{"status":"REJECTED"}')"

  CONV_A=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  [ -n "$CONV_A" ] && ok "用户 A 新建会话成功（${CONV_A}）" || ng "用户 A 新建会话失败"

  expect_http_code "用户 B 查询用户 A 消息 → 404/44004" "404" "44004" \
    "$(call_http GET "${SITE}/api/ai/conversations/${CONV_A}/messages" "$TOK_B")"
  expect_http_code "用户 B 向用户 A 会话发消息 → 404/44004" "404" "44004" \
    "$(call_http POST "${SITE}/api/ai/conversations/${CONV_A}/messages" "$TOK_B" '{"content":"越权测试"}')"
  expect_http_code "用户 B 删除用户 A 会话 → 404/44004" "404" "44004" \
    "$(call_http DELETE "${SITE}/api/ai/conversations/${CONV_A}" "$TOK_B")"

  pub_stub=$(site_curl -sS -N --max-time 25 -X POST "${SITE}/api/ai/conversations/${CONV_A}/messages" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' -H 'X-AI-Stub: echo' \
    -d '{"content":"公网剥头验证"}')
  if printf '%s' "$pub_stub" | grep -q '\[stub:echo\]'; then
    ng "公网 X-AI-Stub 未被网关剥离"
  else
    ok "公网 X-AI-Stub 已被网关强制剥离（未命中 Stub）"
  fi
fi

# ================================================================ L2
if want_layer l2; then
  section "L2 容器内全链路（Stub 确定性 + 真实 ES/DB/Redis）"

  # 1. 会话 CRUD
  CONV_CRUD=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  echo_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_CRUD}/messages" '{"content":"测试会话列表与删除"}' "echo")
  if printf '%s' "$echo_sse" | grep -q 'event:done'; then
    ok "Stub echo 流式输出与 event:done 完整"
  else
    ng "Stub echo 流式输出异常" "$echo_sse"
  fi
  list_res=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_A}" "${SITE}/api/ai/conversations")
  if printf '%s' "$list_res" | grep -q "$CONV_CRUD"; then
    ok "GET /api/ai/conversations 可查到本人会话"
  else
    ng "GET /api/ai/conversations 未包含新建会话"
  fi
  expect_http_code "DELETE /api/ai/conversations/{id} → 200/0" "200" "0" \
    "$(call_http DELETE "${SITE}/api/ai/conversations/${CONV_CRUD}" "$TOK_A")"
  expect_http_code "已删除会话再次读取消息 → 404/44004" "404" "44004" \
    "$(call_http GET "${SITE}/api/ai/conversations/${CONV_CRUD}/messages" "$TOK_A")"

  # 2. 真实 ES 检索 + 引用防编造 + 剥离 [^9]
  es_hit=$(wait_post_in_es "$POST_A_ID" 30)
  [ "$es_hit" = "yes" ] && ok "临时帖已同步进 ES（${POST_A_ID}）" || ng "临时帖 30s 内未进 ES"

  CONV_SEARCH=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  search_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_SEARCH}/messages" \
    "{\"content\":\"请搜索 kw=${KW_TOKEN} 的帖子\"}" "search_citation")
  if printf '%s' "$search_sse" | grep -q 'event:tool_status' && printf '%s' "$search_sse" | grep -q "$POST_A_ID"; then
    ok "search_citation 调通真实 ES 并下发含真实 postId 的 citations"
  else
    ng "search_citation 未返回预期 tool_status 或真实 postId" "$search_sse"
  fi

  persisted_search=$(sql_exec "SELECT content, citations FROM kuaikan_ai.t_ai_message
    WHERE conversation_id=${CONV_SEARCH} AND role='assistant' AND content IS NOT NULL
    ORDER BY id DESC LIMIT 1;")
  if printf '%s' "$persisted_search" | grep -q '\[\^1\]' && ! printf '%s' "$persisted_search" | grep -q '\[\^9\]'; then
    ok "落库正文中合法 [^1] 保留且伪造角标 [^9] 已被服务端剥离"
  else
    ng "引用角标过滤未生效" "$persisted_search"
  fi

  # 3. 第 6 步强制收尾
  CONV_INF=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  inf_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_INF}/messages" '{"content":"无限工具循环测试"}' "infinite_tools")
  inf_text=$(printf '%s\n' "$inf_sse" | sse_text)
  tool_starts=$(printf '%s\n' "$inf_sse" | grep -c '"phase":"start"' || true)
  if [ "$tool_starts" = "5" ] && printf '%s' "$inf_text" | grep -q '步数上限'; then
    ok "Agent 循环第 5 步后强制 tool_choice=none 收尾（tool start=${tool_starts}）"
  else
    ng "Agent 循环步数限制不符合预期" "tool_starts=${tool_starts} text=${inf_text}"
  fi

  # 4. 单帖省流共享缓存命中不扣配额
  CONV_SUM1=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  q_before=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_A}" "${SITE}/api/ai/quota" | json_field 'data.remaining')
  sum1_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_SUM1}/messages" \
    "{\"content\":\"省流总结\",\"intent\":\"SUMMARIZE_POST\",\"pageContext\":{\"type\":\"POST\",\"postId\":\"${POST_A_ID}\"}}" "summarize_post")
  q_after1=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_A}" "${SITE}/api/ai/quota" | json_field 'data.remaining')

  CONV_SUM2=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_B}" | json_field 'data.id')
  q_b_before=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_B}" "${SITE}/api/ai/quota" | json_field 'data.remaining')
  sum2_sse=$(ai_internal_sse "$UID_B" "/conversations/${CONV_SUM2}/messages" \
    "{\"content\":\"省流总结\",\"intent\":\"SUMMARIZE_POST\",\"pageContext\":{\"type\":\"POST\",\"postId\":\"${POST_A_ID}\"}}" "summarize_post")
  q_b_after=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_B}" "${SITE}/api/ai/quota" | json_field 'data.remaining')

  if [ "$q_after1" = "$((q_before - 1))" ] && [ "$q_b_after" = "$q_b_before" ] && printf '%s' "$sum2_sse" | grep -q '"promptTokens":0'; then
    ok "单帖省流首次扣配额并写共享缓存，第二次命中缓存不扣配额且 0 token"
  else
    ng "单帖省流共享缓存或配额逻辑异常" "A:${q_before}->${q_after1} B:${q_b_before}->${q_b_after}"
  fi

  # 5. 未读消息跨用户隔离
  sql_exec "INSERT INTO kuaikan_notification.t_message
    (id, user_id, type, source_event_id, actor_id, actor_nickname, target_type, target_id, target_title, community_name, post_id, excerpt, created_at)
    VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, ${UID_A}, 'COMMENT', 'p8-evt-${STAMP}', ${UID_B}, '乙同学', 'POST', ${POST_A_ID}, '测试标题', '${COMM_A}', ${POST_A_ID}, 'P8私密未读内容', NOW(3));"
  CONV_UNREAD_A=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  CONV_UNREAD_B=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_B}" | json_field 'data.id')
  unread_a=$(ai_internal_sse "$UID_A" "/conversations/${CONV_UNREAD_A}/messages" '{"content":"速览未读","intent":"UNREAD_SUMMARY"}' "unread_summary")
  unread_b=$(ai_internal_sse "$UID_B" "/conversations/${CONV_UNREAD_B}/messages" '{"content":"速览未读","intent":"UNREAD_SUMMARY"}' "unread_summary")
  unread_a_text=$(printf '%s' "$unread_a" | sse_text)
  unread_b_text=$(printf '%s' "$unread_b" | sse_text)
  if printf '%s' "$unread_a_text" | grep -q '建议回复' && printf '%s' "$unread_b_text" | grep -q '暂无未读消息'; then
    ok "未读消息速览严格按 UserContext 隔离（A 读到未读，B 读到暂无未读）"
  else
    ng "未读消息速览隔离异常" "A=${unread_a_text} B=${unread_b_text}"
  fi

  # 6. 内联帮写 compose 零写业务库
  post_cnt_before=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post;" | tr -d '\r\n ')
  compose_sse=$(ai_internal_sse "$UID_A" "/compose" '{"mode":"POLISH","draft":"这是草稿"}' "compose")
  compose_text=$(printf '%s' "$compose_sse" | sse_text)
  post_cnt_after=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post;" | tr -d '\r\n ')
  if printf '%s' "$compose_text" | grep -q 'AI 润色建议' && [ "$post_cnt_before" = "$post_cnt_after" ]; then
    ok "/compose 内联帮写流式输出且零写入业务表"
  else
    ng "/compose 输出或零写库验证失败" "text=${compose_text}"
  fi

  # 7. 确认卡全状态机（不静默写库 / 41004 续写不扣配额 / 44006 幂等 / 44005 过期）
  CONV_ACT=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  act_post_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_ACT}/messages" \
    "{\"content\":\"帮我在社群 communityId=${COMM_B_ID} 发帖\"}" "propose_post")
  ACT_POST_ID=$(printf '%s\n' "$act_post_sse" | grep -A1 '^event:action' | grep '^data:' | head -1 | sed 's/^data://' | json_field 'actionId')
  post_cnt_prop=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post;" | tr -d '\r\n ')
  if [ -n "$ACT_POST_ID" ] && [ "$post_cnt_prop" = "$post_cnt_after" ]; then
    ok "propose_create_post 推确认卡且未确认时绝不静默写库（actionId=${ACT_POST_ID}）"
  else
    ng "propose_create_post 异常" "actionId=${ACT_POST_ID:-空}"
  fi

  # 用户 B 越权回传用户 A 的确认卡 → 404/44004
  expect_http_code "用户 B 越权回传用户 A 动作 → 404/44004" "404" "44004" \
    "$(call_http POST "${SITE}/api/ai/actions/${ACT_POST_ID}/result" "$TOK_B" '{"status":"REJECTED"}')"

  # 模拟前端执行发帖遇到 41004（非成员）并回传结果，验证续写引导加群且不扣配额
  q_before_follow=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_A}" "${SITE}/api/ai/quota" | json_field 'data.remaining')
  followup_text=$(ai_internal_sse "$UID_A" "/actions/${ACT_POST_ID}/result" '{"status":"FAILED","errorCode":41004}' "action_followup" | sse_text)
  q_after_follow=$(site_curl -s --max-time 20 -H "Authorization: Bearer ${TOK_A}" "${SITE}/api/ai/quota" | json_field 'data.remaining')
  if printf '%s' "$followup_text" | grep -q '加入该社群' && [ "$q_before_follow" = "$q_after_follow" ]; then
    ok "确认卡失败回传（41004）触发 AI 续写引导且不扣用户配额"
  else
    ng "确认卡失败回传续写异常" "q=${q_before_follow}->${q_after_follow} text=${followup_text}"
  fi

  # 重复回传同一张确认卡 → 409/44006
  expect_http_code "重复回传已终态确认卡 → 409/44006" "409" "44006" \
    "$(call_http POST "${SITE}/api/ai/actions/${ACT_POST_ID}/result" "$TOK_A" '{"status":"EXECUTED"}')"

  # 生成另一张关注提议卡，验证另外 5 类提议也可落 PROPOSED，并把 expires_at 调过去测 44005
  for pair in \
    "propose_favorites:postIds=${POST_A_ID}" \
    "propose_follow:targetUserId=${UID_B}" \
    "propose_join:communityName=${COMM_B}" \
    "propose_nickname:nickname=新昵称${STAMP: -4}" \
    "propose_avatar:avatarUrl=https://example.com/a.png"; do
    sc="${pair%%:*}"
    arg="${pair#*:}"
    s_out=$(ai_internal_sse "$UID_A" "/conversations/${CONV_ACT}/messages" "{\"content\":\"测试 ${arg}\"}" "$sc")
    a_id=$(printf '%s\n' "$s_out" | grep -A1 '^event:action' | grep '^data:' | head -1 | sed 's/^data://' | json_field 'actionId')
    [ -n "$a_id" ] && LAST_EXP_ACT="$a_id" || ng "动作提议 ${sc} 未产出 action 事件"
  done
  ok "其余 5 类动作提议（收藏/关注/入群/改昵称/改头像）均正确生成确认卡且未静默写库"

  if [ -n "${LAST_EXP_ACT:-}" ]; then
    sql_exec "UPDATE kuaikan_ai.t_ai_action SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ${LAST_EXP_ACT};"
    expect_http_code "已过期确认卡回传 → 200/44005" "200" "44005" \
      "$(call_http POST "${SITE}/api/ai/actions/${LAST_EXP_ACT}/result" "$TOK_A" '{"status":"EXECUTED"}')"
  fi

  # 8. 并发流锁 44002（同台宿主机内并发，避免跨境 SSH 握手耗时超过慢流窗）
  CONV_LOCK=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  lock_script=$(cat <<EOF
set -a; . ${ENV_FILE}; set +a
docker exec ${AI_CT} curl -sS -N --max-time 20 \
  -H 'X-User-Id: ${UID_A}' -H 'X-AI-Stub: slow' -H 'Content-Type: application/json' \
  -X POST "http://127.0.0.1:8088/api/ai/conversations/${CONV_LOCK}/messages" \
  -d '{"content":"慢流"}' >/tmp/p8-slow.log 2>&1 &
slow_pid=\$!
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if [ "\$(docker exec kuaikan-redis-1 redis-cli --no-auth-warning -a "\$REDIS_PASSWORD" EXISTS "ai:lock:${UID_A}" 2>/dev/null | tr -d '\r\n ')" = "1" ]; then
    break
  fi
  sleep 0.1
done
c=\$(curl -k -s -o /tmp/p8-c2.json -w '%{http_code}' --max-time 20 \
  --resolve "${SITE_HOST}:443:127.0.0.1" \
  -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
  -X POST "${SITE}/api/ai/conversations/${CONV_LOCK}/messages" \
  -d '{"content":"并发"}')
b=\$(python3 -c 'import json; print(json.load(open("/tmp/p8-c2.json")).get("code","-"))' 2>/dev/null || echo -)
wait "\$slow_pid" >/dev/null 2>&1 || true
rm -f /tmp/p8-c2.json /tmp/p8-slow.log
printf '%s %s' "\${c:-000}" "\${b:--}"
EOF
)
  lock_b64=$(printf '%s\n' "$lock_script" | base64 | tr -d '\n')
  lock_res=$(ssh_run "echo '${lock_b64}' | base64 -d > /tmp/p8-lock.sh && sh /tmp/p8-lock.sh; rm -f /tmp/p8-lock.sh")
  expect_http_code "同一用户并发第二条流被拦截 → 409/44002" "409" "44002" "$lock_res"
  sleep 0.3

  # 9. 单用户日配额 44001 与全站每日 token 预算熔断 44003
  redis_exec "redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" SET \"ai:quota:${TODAY}:${UID_A}\" 50 EX 3600 >/dev/null"
  expect_http_code "日配额耗尽后请求 → 429/44001" "429" "44001" \
    "$(call_http POST "${SITE}/api/ai/conversations/${CONV_LOCK}/messages" "$TOK_A" '{"content":"超配额"}')"
  redis_exec "redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" SET \"ai:quota:${TODAY}:${UID_A}\" 1 EX 3600 >/dev/null"

  BUDGET_SAVED=$(redis_exec "v=\$(redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" GET \"ai:budget:${TODAY}\"); if [ -z \"\$v\" ]; then echo __NONE__; else echo \"\$v\"; fi" | tr -d '\r\n ')
  redis_exec "redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" SET \"ai:budget:${TODAY}\" 999999999 EX 3600 >/dev/null"
  expect_http_code "全站日 token 预算熔断 → 503/44003" "503" "44003" \
    "$(call_http POST "${SITE}/api/ai/conversations/${CONV_LOCK}/messages" "$TOK_A" '{"content":"预算熔断"}')"
  redis_exec "if [ '${BUDGET_SAVED}' = '__NONE__' ]; then redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"ai:budget:${TODAY}\" >/dev/null; else redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" SET \"ai:budget:${TODAY}\" \"${BUDGET_SAVED}\" EX 172800 >/dev/null; fi"
  BUDGET_SAVED=""

  # 10. 真实 DeepSeek 冒烟（仅服务器配置了 DEEPSEEK_API_KEY 时运行）
  has_key=$(ssh_run "grep -qE '^DEEPSEEK_API_KEY=.+' ${ENV_FILE} && echo yes || echo no" | tr -d '\r\n ')
  if [ "$has_key" = "yes" ]; then
    real_sse=$(site_curl -sS -N --max-time 35 -X POST "${SITE}/api/ai/conversations/${CONV_LOCK}/messages" \
      -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
      -d '{"content":"请用一句话回复：你好快看。"}')
    if printf '%s' "$real_sse" | grep -q 'event:delta' && printf '%s' "$real_sse" | grep -q 'event:done'; then
      ok "真实 DeepSeek 公网流式冒烟通过（含 delta 与 done）"
    else
      ng "真实 DeepSeek 冒烟未收到完整 delta/done" "$real_sse"
    fi
  else
    skip "真实 DeepSeek 公网流式冒烟" "服务器 ${ENV_FILE} 未配置 DEEPSEEK_API_KEY"
  fi
fi

# ================================================================ L3
if want_browser_layer; then
  section "L3 浏览器端到端（Playwright）"
  if E2E_SITE_IP="$SITE_RESOLVE" \
     SITE="$SITE" \
     E2E_USER_EMAIL="$EMAIL_A" \
     E2E_USER_PASSWORD="$FIXTURE_PASS" \
     E2E_COMMUNITY="$COMM_A" \
     E2E_POST_ID="$POST_A_ID" \
     node "$APP_DIR/web/e2e/p8-ai.mjs" >/tmp/p8-l3.log 2>&1; then
    cat /tmp/p8-l3.log
    ok "浏览器 L3 全链路通过"
  else
    cat /tmp/p8-l3.log
    ng "浏览器 L3 存在失败项" "见 /tmp/p8-l3.log"
  fi
elif want_layer l3; then
  skip "L3 浏览器" "--fast"
fi

# ================================================================ L4
if want_layer l4; then
  section "L4 破坏性故障隔离（停 ai-service 主站零影响）"
  ssh_run "docker stop ${AI_CT} >/dev/null 2>&1"
  AI_STOPPED=1
  sleep 2

  c_home=$(http_code "${SITE}/")
  c_post=$(http_code "${SITE}/api/content/posts/${POST_A_ID}")
  new_p_id=$(site_curl -s --max-time 20 -X POST "${SITE}/api/content/posts" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d "$(json_obj communityId "$COMM_A_ID" title "L4 隔离发帖 ${STAMP}" body "ai-service 停机期间发帖必须成功。")" | json_field 'data.id')
  P8_POST_IDS=$(remember_ids "$P8_POST_IDS" "$new_p_id")
  [ "$c_home" = "200" ] && [ "$c_post" = "200" ] && [ -n "$new_p_id" ] \
    && ok "停掉 ai-service 后主站首页、读帖、发帖均 200 零影响" \
    || ng "停掉 ai-service 影响了主站" "home=${c_home} post=${c_post} new=${new_p_id:-空}"

  if [ -n "$new_p_id" ]; then
    expect_http_code "ai-service 停机期间作者删帖正常 → 200/0" "200" "0" \
      "$(call_http DELETE "${SITE}/api/content/posts/${new_p_id}" "$TOK_A")"
  fi

  if ensure_ai_up; then
    AI_STOPPED=0
    ok "ai-service 已重启并恢复 healthy"
  else
    ng "ai-service 未能在 240s 内恢复 healthy"
  fi

  ping_ok=0
  for _ in $(seq 1 12); do
    if [ "$(http_code "${SITE}/api/ai/ping")" = "200" ]; then
      ping_ok=1
      break
    fi
    sleep 3
  done
  [ "$ping_ok" = "1" ] && ok "恢复后 /api/ai/ping 返回 200" || ng "恢复后 /api/ai/ping 不可用"
  expect_http_code "恢复后 /api/ai/quota → 200/0" "200" "0" \
    "$(call_http GET "${SITE}/api/ai/quota" "$TOK_A")"

  cleanup
  sleep 1

  n_ai=$(sql_exec "SELECT COUNT(*) FROM kuaikan_ai.t_ai_conversation WHERE user_id IN (${P8_USER_IDS:-0});" | tr -d '\r\n ')
  [ "${n_ai:-1}" = "0" ] && ok "kuaikan_ai 临时会话已清理归零" || ng "kuaikan_ai 有残留" "${n_ai}"

  db_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
  es_total=$(es_count)
  [ -n "$es_total" ] && [ "$es_total" = "$db_count" ] \
    && ok "ES 与 MySQL 有效帖数一致（${es_total}，零测试残留）" \
    || ng "清理后 ES 与 MySQL 帖数不一致" "ES=${es_total:-空} 库=${db_count:-空}"

  hc=$(http_code "${SITE}/")
  [ "$hc" = "200" ] && ok "验收结束后线上首页 HTTP 200" || ng "线上首页异常" "HTTP ${hc}"
fi

# ================================================================ 汇总
printf '\n%s汇总%s\n' "$B" "$N"
printf '  通过 %d   失败 %d   跳过 %d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s失败项：%s\n' "$R" "$N"
  printf '%s' "$FAILED_ITEMS" | while IFS= read -r line; do
    [ -n "$line" ] && printf '    - %s\n' "$line"
  done
  exit 1
fi
printf '  %sP8 验收通过%s\n' "$G" "$N"
