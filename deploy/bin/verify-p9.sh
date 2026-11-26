#!/usr/bin/env bash
# P9 向量知识库与个人权威档案分层验收脚本。
#
#   ./deploy/bin/verify-p9.sh              全量（L0 → L4）
#   ./deploy/bin/verify-p9.sh --layer l2   只跑某一层
#   ./deploy/bin/verify-p9.sh --fast       跳过浏览器层（L3）
#
# 分层：
#   L0 契约与静态检查   check-contract（40 码）/ check-openapi（95 operationId）/
#                       check-scripts / deploy-bin bash -n / web typecheck+lint+build /
#                       工作区干净（全量时）/ 网关仅放行相关帖 GET 正则
#   L1 鉴权与越权边界   游客读 related 200；游客调档案/笔记 401+40100；
#                       用户 B 读写删用户 A 档案与笔记一律 404+44008/44010
#   L2 容器内全链路     Stub + 真实 TEI/ES/MySQL/RocketMQ：
#                       1) 混合检索跨词语义召回 + [社区帖子] 来源标签
#                       2) 档案提议未确认零写库、确认后注入、停用不注入、30 条上限 44007
#                       3) 私密笔记异步入库 → 本人 search_my_knowledge 召回带 NOTE 标签 →
#                          跨用户零越权 → 停用与硬删除后立即可验证零召回 + ES 清理
#                       4) MY_ONLY 检索范围物理隔离 search_posts
#   L3 浏览器           web/e2e/p9-kb.mjs
#   L4 破坏性故障隔离   停 tei-embedding → 主站首页/读帖/P6 搜索/混合检索降级 BM25 均正常 →
#                       恢复 tei-embedding healthy
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
SEARCH_CT="${SEARCH_CT:-kuaikan-search-service-1}"
TEI_CT="${TEI_CT:-kuaikan-tei-embedding-1}"
ES_CT="${ES_CT:-kuaikan-elasticsearch-1}"
ES_URL="http://127.0.0.1:9200"

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
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

printf '%s%s%s\n' "$B" "kuaikan · P9 向量知识库与个人权威档案验收" "$N"
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
  ssh_run "echo '${b64}' | base64 -d > /tmp/p9-fixture.sql
    set -a; . ${ENV_FILE}; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p9-fixture.sql 2>/dev/null
    rm -f /tmp/p9-fixture.sql"
}

redis_exec() {
  local b64
  b64=$(printf '%s\n' "$1" | base64 | tr -d '\n')
  ssh_run "echo '${b64}' | base64 -d > /tmp/p9-redis.sh
    set -a; . ${ENV_FILE}; set +a
    docker exec -i kuaikan-redis-1 sh -s < /tmp/p9-redis.sh
    rm -f /tmp/p9-redis.sh"
}

http_code() {
  local c
  c=$(site_curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-20}" "$1" 2>/dev/null)
  printf '%s' "${c:-000}"
}

call_http() {
  local method="$1" url="$2" token="${3:-}" body="${4:-}" tmp c b _try
  tmp=$(mktemp)
  local args=(-s -o "$tmp" -w '%{http_code}' --max-time 20 -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer ${token}")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  for _try in 1 2; do
    c=$(site_curl "${args[@]}" 2>/dev/null || true)
    [ "${c:-000}" != "000" ] && break
    sleep 0.5
  done
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
es_count_alias() { es_get "/${1}/_count" | json_field 'count'; }

es_term_count() {
  local alias="$1" field="$2" val="$3"
  ssh_run "docker exec ${ES_CT} curl -s --max-time 15 -X POST '${ES_URL}/${alias}/_count' -H 'Content-Type: application/json' -d '{\"query\":{\"term\":{\"${field}\":\"${val}\"}}}'" | json_field 'count'
}

wait_term_count() {
  local alias="$1" field="$2" val="$3" target="$4" timeout="$5" waited=0 cnt=""
  while [ "$waited" -lt "$timeout" ]; do
    cnt=$(es_term_count "$alias" "$field" "$val")
    if [ "$target" = "ANY" ] && [ -n "$cnt" ] && [ "$cnt" -gt 0 ] 2>/dev/null; then
      printf '%s' "$cnt"
      return 0
    elif [ "$cnt" = "$target" ]; then
      printf '%s' "$cnt"
      return 0
    fi
    sleep 1
    waited=$((waited+1))
  done
  printf '%s' "${cnt:-0}"
  return 1
}

ensure_tei_up() {
  ssh_run "docker start ${TEI_CT} >/dev/null 2>&1 || true"
  local waited=0 st
  while [ "$waited" -lt 180 ]; do
    st=$(ssh_run "docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${TEI_CT} 2>/dev/null")
    [ "$st" = "healthy" ] && return 0
    sleep 5
    waited=$((waited+5))
  done
  return 1
}

ai_internal_sse() {
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

# ---------------------------------------------------------------- 夹具与清理
FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
TODAY=$(date -u -d '+8 hours' '+%Y%m%d' 2>/dev/null || TZ=Asia/Shanghai date '+%Y%m%d')
CLEANUP_NEEDED=0
CLEANED=0
TEI_STOPPED=0
P9_USER_IDS=""
P9_POST_IDS=""

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

  if [ "$TEI_STOPPED" = "1" ]; then
    ensure_tei_up >/dev/null 2>&1 || true
    TEI_STOPPED=0
  fi

  [ "$CLEANUP_NEEDED" = "0" ] && return 0
  info "清理 P9 临时测试数据…"

  local uid_list="${P9_USER_IDS:-0}"
  local pid_list="${P9_POST_IDS:-0}"
  local has_posts=0
  [ -n "$P9_POST_IDS" ] && has_posts=1

  sql_exec "
    DELETE FROM kuaikan_ai.t_ai_profile_entry WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_ai.t_ai_note WHERE owner_id IN (${uid_list});
    DELETE FROM kuaikan_ai.t_outbox WHERE payload LIKE '%e2e-p9-%' OR status = 1;
    DELETE FROM kuaikan_ai.t_ai_action WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_ai.t_ai_message WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_ai.t_ai_conversation WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_content.t_post WHERE author_id IN (${uid_list}) OR id IN (${pid_list});
    DELETE FROM kuaikan_community.t_community_history WHERE operator_id IN (${uid_list}) OR community_id IN (SELECT id FROM kuaikan_community.t_community WHERE name LIKE 'e2e-p9-%');
    DELETE FROM kuaikan_community.t_community_member WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_community.t_community WHERE name LIKE 'e2e-p9-%';
    DELETE FROM kuaikan_user.t_refresh_token WHERE user_id IN (${uid_list});
    DELETE FROM kuaikan_user.t_user WHERE id IN (${uid_list}) OR email LIKE 'e2e+p9%@kuaikan.test';
    DELETE FROM kuaikan_content.t_outbox WHERE payload LIKE '%e2e-p9-%';
  " >/dev/null 2>&1 || true

  redis_exec "
    for uid in $(printf '%s' "${uid_list}" | tr ',' ' '); do
      for jti in \$(redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZRANGE \"auth:user:\$uid:access\" 0 -1); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:session:\$jti\" >/dev/null
      done
      redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:user:\$uid:access\" \"ai:quota:${TODAY}:\$uid\" \"ai:lock:stream:\$uid\" >/dev/null
    done
  " >/dev/null 2>&1 || true

  if [ "$has_posts" = "1" ]; then
    ssh_run "docker exec ${SEARCH_CT} curl -s --max-time 90 -X POST 'http://127.0.0.1:8086/internal/admin/rebuild?target=ALL'" >/dev/null 2>&1 || true
  else
    ssh_run "docker exec ${SEARCH_CT} curl -s --max-time 30 -X POST 'http://127.0.0.1:8086/internal/admin/rebuild?target=NOTE_CHUNK'" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

# ================================================================ L0
if want_layer l0; then
  section "L0 本地契约与静态检查"
  if node "$APP_DIR/deploy/bin/check-contract.mjs" >/tmp/p9-l0-contract.log 2>&1; then
    ok "check-contract.mjs 一致（40 码）"
  else
    ng "check-contract.mjs 失败" "$(tail -3 /tmp/p9-l0-contract.log | tr '\n' ' ')"
  fi

  if node "$APP_DIR/deploy/bin/check-openapi.mjs" >/tmp/p9-l0-openapi.log 2>&1; then
    ok "check-openapi.mjs 一致（95 operationId）"
  else
    ng "check-openapi.mjs 失败" "$(tail -3 /tmp/p9-l0-openapi.log | tr '\n' ' ')"
  fi

  if node "$APP_DIR/deploy/bin/check-scripts.mjs" >/tmp/p9-l0-scripts.log 2>&1; then
    ok "check-scripts.mjs 通过"
  else
    ng "check-scripts.mjs 失败" "$(tail -3 /tmp/p9-l0-scripts.log | tr '\n' ' ')"
  fi

  sh_bad=0
  for f in "$APP_DIR"/deploy/bin/*.sh; do
    bash -n "$f" || sh_bad=1
  done
  [ "$sh_bad" = "0" ] && ok "deploy/bin/*.sh 全部 bash -n 语法通过" || ng "deploy/bin/*.sh 存在语法错误"

  if (cd "$WEB_DIR" && npm run typecheck && npm run lint && npm run build >/tmp/p9-l0-web.log 2>&1); then
    ok "web typecheck + lint + build 全部通过"
  else
    ng "web 构建或静态检查失败" "见 /tmp/p9-l0-web.log"
  fi

  gw_yml="$APP_DIR/services/gateway/src/main/resources/application.yml"
  if grep -q "GET \^/api/search/posts/\[\^/\]+/related\$" "$gw_yml" && ! grep -q "/api/ai/" <(grep -E "^\s*- .*\/api\/" "$gw_yml" | grep -v "Path="); then
    ok "网关已放行相关帖子 GET 正则且 /api/ai/** 无白名单"
  else
    ng "网关白名单规则异常"
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
if want_layer l1 || want_layer l2 || want_browser_layer || want_layer l4; then
  NEED_FIXTURE=1
fi

if [ "$NEED_FIXTURE" = "1" ]; then
  section "准备 P9 临时验证夹具"
  CLEANUP_NEEDED=1

  EMAIL_A="e2e+p9a+${STAMP}@kuaikan.test"
  EMAIL_B="e2e+p9b+${STAMP}@kuaikan.test"
  UID_A=$(mk_user "$EMAIL_A" "P9测试甲_${STAMP: -4}")
  UID_B=$(mk_user "$EMAIL_B" "P9测试乙_${STAMP: -4}")
  P9_USER_IDS=$(remember_ids "$P9_USER_IDS" "$UID_A")
  P9_USER_IDS=$(remember_ids "$P9_USER_IDS" "$UID_B")
  TOK_A=$(login_token "$EMAIL_A" "$FIXTURE_PASS")
  TOK_B=$(login_token "$EMAIL_B" "$FIXTURE_PASS")

  COMM_A="e2e-p9-${STAMP}"
  COMM_A_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/community/communities" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d "$(json_obj name "$COMM_A")" | json_field 'data.id')

  POST_A_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/content/posts" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d "$(json_obj communityId "$COMM_A_ID" title "JVM 容器冷启动加速实战_${STAMP}" body "通过精简镜像层与类数据共享，把服务启动耗时从三秒降到三十毫秒以内。")" | json_field 'data.id')
  P9_POST_IDS=$(remember_ids "$P9_POST_IDS" "$POST_A_ID")

  if [ -n "$UID_A" ] && [ -n "$UID_B" ] && [ -n "$TOK_A" ] && [ -n "$TOK_B" ] && [ -n "$POST_A_ID" ]; then
    ok "临时账号与帖子夹具就绪（UID_A=${UID_A} POST_A=${POST_A_ID}）"
  else
    ng "临时夹具创建失败"
  fi
fi

# ================================================================ L1
if want_layer l1; then
  section "L1 鉴权与跨用户越权隔离"
  expect_http_code "游客 GET /api/search/posts/{id}/related → 200/0" "200" "0" \
    "$(call_http GET "${SITE}/api/search/posts/2121868195117584385/related")"
  expect_http_code "游客 GET /api/ai/profile/entries → 401/40100" "401" "40100" \
    "$(call_http GET "${SITE}/api/ai/profile/entries")"
  expect_http_code "游客 POST /api/ai/profile/entries → 401/40100" "401" "40100" \
    "$(call_http POST "${SITE}/api/ai/profile/entries" "" '{"category":"PREFERENCE","content":"hi"}')"
  expect_http_code "游客 GET /api/ai/notes → 401/40100" "401" "40100" \
    "$(call_http GET "${SITE}/api/ai/notes")"
  expect_http_code "游客 POST /api/ai/notes → 401/40100" "401" "40100" \
    "$(call_http POST "${SITE}/api/ai/notes" "" '{"title":"t","content":"c"}')"

  PROF_A_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/profile/entries" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d '{"category":"PREFERENCE","content":"L1 档案归属测试"}' | json_field 'data.id')
  NOTE_A_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/notes" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d '{"title":"L1私密笔记","content":"只有甲能看的笔记正文"}' | json_field 'data.id')

  if [ -n "$PROF_A_ID" ] && [ -n "$NOTE_A_ID" ]; then
    ok "用户 A 创建档案（${PROF_A_ID}）与私密笔记（${NOTE_A_ID}）成功"
  else
    ng "用户 A 创建档案或笔记失败"
  fi

  expect_http_code "用户 B 修改用户 A 档案 → 404/44008" "404" "44008" \
    "$(call_http PUT "${SITE}/api/ai/profile/entries/${PROF_A_ID}" "$TOK_B" '{"content":"篡改"}')"
  expect_http_code "用户 B 删除用户 A 档案 → 404/44008" "404" "44008" \
    "$(call_http DELETE "${SITE}/api/ai/profile/entries/${PROF_A_ID}" "$TOK_B")"
  expect_http_code "用户 B 读取用户 A 笔记 → 404/44010" "404" "44010" \
    "$(call_http GET "${SITE}/api/ai/notes/${NOTE_A_ID}" "$TOK_B")"
  expect_http_code "用户 B 修改用户 A 笔记 → 404/44010" "404" "44010" \
    "$(call_http PUT "${SITE}/api/ai/notes/${NOTE_A_ID}" "$TOK_B" '{"title":"改","content":"改"}')"
  expect_http_code "用户 B 删除用户 A 笔记 → 404/44010" "404" "44010" \
    "$(call_http DELETE "${SITE}/api/ai/notes/${NOTE_A_ID}" "$TOK_B")"

  # 清理 L1 临时档案与笔记，免干扰 L2 上限计数
  call_http DELETE "${SITE}/api/ai/profile/entries/${PROF_A_ID}" "$TOK_A" >/dev/null
  call_http DELETE "${SITE}/api/ai/notes/${NOTE_A_ID}" "$TOK_A" >/dev/null
fi

# ================================================================ L2
if want_layer l2; then
  section "L2 容器内全链路（混合检索 / 档案闭环 / 私密笔记硬隔离 / 范围约束）"

  # 1. 新发帖异步入 post_chunk_read，验证跨词语义混合召回与 [社区帖子] 来源标签
  pc_cnt=$(wait_term_count "post_chunk_read" "postId" "$POST_A_ID" "ANY" 25)
  [ "$pc_cnt" -gt 0 ] 2>/dev/null \
    && ok "新发帖已异步切片向量化进入 post_chunk_read（chunks=${pc_cnt}）" \
    || ng "新发帖 25s 内未进入 post_chunk_read"

  CONV_HYBRID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  hybrid_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_HYBRID}/messages" \
    "{\"content\":\"请搜索 kw=为什么应用刚拉起来的时候这么慢\"}" "search_citation")
  if printf '%s' "$hybrid_sse" | grep -q "$POST_A_ID" && printf '%s' "$hybrid_sse" | grep -q '"sourceType":"POST"'; then
    ok "Copilot search_posts 跨词语义混合召回成功且附 sourceType=POST"
  else
    ng "Copilot 混合检索未召回新发帖或缺少 sourceType" "$hybrid_sse"
  fi

  # 2. 个人 AI 档案：提议未确认零写入 -> 确认写入 -> system prompt 注入 -> 停用不注入 -> 30 条上限 44007
  CONV_PROF=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  prop_prof_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_PROF}/messages" \
    '{"content":"记住我喜欢简洁带代码的 Java 技术回答"}' "propose_profile")
  ACT_PROF_ID=$(printf '%s\n' "$prop_prof_sse" | grep -A1 '^event:action' | grep '^data:' | head -1 | sed 's/^data://' | json_field 'actionId')
  prof_cnt_before=$(sql_exec "SELECT COUNT(*) FROM kuaikan_ai.t_ai_profile_entry WHERE user_id=${UID_A};" | tr -d '\r\n ')
  if [ -n "$ACT_PROF_ID" ] && [ "$prof_cnt_before" = "0" ]; then
    ok "propose_save_profile 推确认卡且未确认时档案表零写入（actionId=${ACT_PROF_ID}）"
  else
    ng "propose_save_profile 未推卡或发生了静默写库" "cnt=${prof_cnt_before}"
  fi

  PROF_CONFIRMED_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/profile/entries" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d '{"category":"PREFERENCE","content":"偏好简洁带代码的 Java 技术回答","enabled":true,"source":"AI_CONFIRMED"}' | json_field 'data.id')
  ai_internal_sse "$UID_A" "/actions/${ACT_PROF_ID}/result" \
    "{\"status\":\"EXECUTED\",\"resultRef\":\"${PROF_CONFIRMED_ID}\"}" "action_followup" >/dev/null

  echo_on=$(ai_internal_sse "$UID_A" "/conversations/${CONV_PROF}/messages" '{"content":"测试档案注入"}' "profile_echo" | sse_text)
  if printf '%s' "$echo_on" | grep -q '偏好简洁带代码的 Java 技术回答'; then
    ok "已确认启用的档案条目成功注入对话 system prompt"
  else
    ng "档案条目未注入 system prompt" "$echo_on"
  fi

  call_http PUT "${SITE}/api/ai/profile/entries/${PROF_CONFIRMED_ID}" "$TOK_A" '{"enabled":false}' >/dev/null
  echo_off=$(ai_internal_sse "$UID_A" "/conversations/${CONV_PROF}/messages" '{"content":"测试档案停用"}' "profile_echo" | sse_text)
  if ! printf '%s' "$echo_off" | grep -q '偏好简洁带代码的 Java 技术回答'; then
    ok "停用档案条目后不再注入对话 system prompt"
  else
    ng "停用档案条目后仍被注入" "$echo_off"
  fi

  # 上限 30 条 -> 第 31 条返 200/44007
  bulk_sql=""
  for i in $(seq 1 29); do
    bulk_sql="${bulk_sql}INSERT INTO kuaikan_ai.t_ai_profile_entry (id, user_id, category, content, enabled, source) VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, ${UID_A}, 'OTHER', '批量上限占位_${i}', 0, 'MANUAL');"
  done
  sql_exec "$bulk_sql"
  expect_http_code "档案条目达 30 条后继续新增 → 200/44007" "200" "44007" \
    "$(call_http POST "${SITE}/api/ai/profile/entries" "$TOK_A" '{"category":"OTHER","content":"第31条"}')"
  sql_exec "DELETE FROM kuaikan_ai.t_ai_profile_entry WHERE user_id=${UID_A} AND content LIKE '批量上限占位_%';"

  # 3. 私密笔记：异步入库 -> 本人召回(NOTE) -> 跨用户零召回 -> 停用即刻零召回 -> 硬删除即刻零召回且清向量
  NOTE_PRIV_ID=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/notes" \
    -H "Authorization: Bearer ${TOK_A}" -H 'Content-Type: application/json' \
    -d '{"title":"手冲咖啡配方秘籍","content":"耶加雪菲浅烘豆建议使用九十二度热水闷蒸三十秒。","enabled":true}' | json_field 'data.id')
  nc_cnt=$(wait_term_count "note_chunk_read" "noteId" "$NOTE_PRIV_ID" "ANY" 25)
  [ "$nc_cnt" -gt 0 ] 2>/dev/null \
    && ok "私密笔记经 outbox/MQ 异步向量化进入 note_chunk_read（chunks=${nc_cnt}）" \
    || ng "私密笔记 25s 内未进入 note_chunk_read"

  CONV_KB_A=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_A}" | json_field 'data.id')
  kb_a_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_KB_A}/messages" \
    '{"content":"查我的笔记 kw=手冲热水温度多少合适","retrievalScope":"MY_ONLY"}' "search_my_kb")
  if printf '%s' "$kb_a_sse" | grep -q "$NOTE_PRIV_ID" && printf '%s' "$kb_a_sse" | grep -q '"sourceType":"NOTE"'; then
    ok "本人通过 search_my_knowledge 成功语义召回私密笔记并附 sourceType=NOTE"
  else
    ng "本人未召回私密笔记或缺少 sourceType=NOTE" "$kb_a_sse"
  fi

  CONV_KB_B=$(site_curl -s --max-time 20 -X POST "${SITE}/api/ai/conversations" \
    -H "Authorization: Bearer ${TOK_B}" | json_field 'data.id')
  kb_b_sse=$(ai_internal_sse "$UID_B" "/conversations/${CONV_KB_B}/messages" \
    '{"content":"查我的笔记 kw=手冲热水温度多少合适","retrievalScope":"MY_ONLY"}' "search_my_kb")
  if ! printf '%s' "$kb_b_sse" | grep -q "$NOTE_PRIV_ID" && ! printf '%s' "$kb_b_sse" | grep -q '耶加雪菲'; then
    ok "跨用户检索本人私密笔记严格零越权召回"
  else
    ng "跨用户检索意外命中了用户 A 的私密笔记" "$kb_b_sse"
  fi

  # 停用笔记：立即可验证不再被召回（读侧 MySQL 强一致拦截）
  call_http PUT "${SITE}/api/ai/notes/${NOTE_PRIV_ID}" "$TOK_A" '{"enabled":false}' >/dev/null
  kb_disabled_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_KB_A}/messages" \
    '{"content":"查我的笔记 kw=手冲热水温度多少合适","retrievalScope":"MY_ONLY"}' "search_my_kb")
  if ! printf '%s' "$kb_disabled_sse" | grep -q "$NOTE_PRIV_ID"; then
    ok "停用笔记后立即可验证不再被召回（读侧 MySQL 校验兜底生效）"
  else
    ng "停用笔记后仍被召回" "$kb_disabled_sse"
  fi

  # 重新启用后硬删除，验证立即可验证不再被召回且 ES 向量被清干净
  call_http PUT "${SITE}/api/ai/notes/${NOTE_PRIV_ID}" "$TOK_A" '{"enabled":true}' >/dev/null
  wait_term_count "note_chunk_read" "noteId" "$NOTE_PRIV_ID" "ANY" 20 >/dev/null
  expect_http_code "硬删除私密笔记 → 200/0" "200" "0" \
    "$(call_http DELETE "${SITE}/api/ai/notes/${NOTE_PRIV_ID}" "$TOK_A")"
  kb_deleted_sse=$(ai_internal_sse "$UID_A" "/conversations/${CONV_KB_A}/messages" \
    '{"content":"查我的笔记 kw=手冲热水温度多少合适","retrievalScope":"MY_ONLY"}' "search_my_kb")
  if ! printf '%s' "$kb_deleted_sse" | grep -q "$NOTE_PRIV_ID"; then
    ok "硬删除笔记后立即可验证零召回"
  else
    ng "硬删除笔记后仍被召回" "$kb_deleted_sse"
  fi
  if wait_term_count "note_chunk_read" "noteId" "$NOTE_PRIV_ID" "0" 20 >/dev/null; then
    ok "硬删除笔记后 note_chunk_read 向量切片已同步清空"
  else
    ng "硬删除笔记 20s 后 note_chunk_read 仍有残留"
  fi

  # 4. retrievalScope=MY_ONLY 强约束不挂载 search_posts
  scope_my=$(ai_internal_sse "$UID_A" "/conversations/${CONV_KB_A}/messages" \
    '{"content":"范围检查","retrievalScope":"MY_ONLY"}' "scope_check" | sse_text)
  scope_all=$(ai_internal_sse "$UID_A" "/conversations/${CONV_KB_A}/messages" \
    '{"content":"范围检查","retrievalScope":"ALL"}' "scope_check" | sse_text)
  if printf '%s' "$scope_my" | grep -q 'search_posts=false' && printf '%s' "$scope_all" | grep -q 'search_posts=true'; then
    ok "retrievalScope=MY_ONLY 后端强约束移除了 search_posts 工具"
  else
    ng "retrievalScope 工具隔离异常" "my=${scope_my} all=${scope_all}"
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
     node "$APP_DIR/web/e2e/p9-kb.mjs" >/tmp/p9-l3.log 2>&1; then
    cat /tmp/p9-l3.log
    ok "浏览器 L3 全链路通过"
  else
    cat /tmp/p9-l3.log
    ng "浏览器 L3 存在失败项" "见 /tmp/p9-l3.log"
  fi
elif want_layer l3; then
  skip "L3 浏览器" "--fast"
fi

# ================================================================ L4
if want_layer l4; then
  section "L4 破坏性故障隔离（停 tei-embedding 主站与 P6 搜索零影响）"
  ssh_run "docker stop ${TEI_CT} >/dev/null 2>&1"
  TEI_STOPPED=1
  sleep 2

  c_home=$(http_code "${SITE}/")
  c_search=$(http_code "${SITE}/api/search/posts?q=Rust")
  c_rel=$(http_code "${SITE}/api/search/posts/2121868195117584385/related")
  [ "$c_home" = "200" ] && [ "$c_search" = "200" ] && [ "$c_rel" = "200" ] \
    && ok "停掉 tei-embedding 后首页、P6 关键词搜索与相关帖接口均返回 200 零影响" \
    || ng "停掉 tei-embedding 影响了主站接口" "home=${c_home} search=${c_search} related=${c_rel}"

  # 验证混合检索在 TEI 停机时自动退化纯 BM25 仍能命中
  degrade_res=$(ssh_run "docker exec ${SEARCH_CT} curl -sS --max-time 15 -X POST http://127.0.0.1:8086/internal/search/posts -H 'Content-Type: application/json' -d '{\"keyword\":\"Rust\",\"mode\":\"HYBRID\",\"limit\":3}'")
  if printf '%s' "$degrade_res" | grep -q '"code":0' && printf '%s' "$degrade_res" | grep -q 'postId'; then
    ok "TEI 停机时 /internal/search/posts HYBRID 自动降级纯 BM25 正常返回"
  else
    ng "TEI 停机时混合检索未正常降级" "$degrade_res"
  fi

  if ensure_tei_up; then
    TEI_STOPPED=0
    ok "tei-embedding 已重启并恢复 healthy"
  else
    ng "tei-embedding 未能在 180s 内恢复 healthy"
  fi

  cleanup
  sleep 2

  n_prof=$(sql_exec "SELECT COUNT(*) FROM kuaikan_ai.t_ai_profile_entry WHERE user_id IN (${P9_USER_IDS:-0});" | tr -d '\r\n ')
  n_note=$(sql_exec "SELECT COUNT(*) FROM kuaikan_ai.t_ai_note WHERE owner_id IN (${P9_USER_IDS:-0});" | tr -d '\r\n ')
  n_conv=$(sql_exec "SELECT COUNT(*) FROM kuaikan_ai.t_ai_conversation WHERE user_id IN (${P9_USER_IDS:-0});" | tr -d '\r\n ')
  [ "${n_prof:-1}" = "0" ] && [ "${n_note:-1}" = "0" ] && [ "${n_conv:-1}" = "0" ] \
    && ok "kuaikan_ai 临时档案/笔记/会话已清理归零" \
    || ng "kuaikan_ai 有残留" "prof=${n_prof} note=${n_note} conv=${n_conv}"

  db_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
  es_total=$(es_count_alias "post_read")
  [ -n "$es_total" ] && [ "$es_total" = "$db_count" ] \
    && ok "ES post_read 与 MySQL 有效帖数一致（${es_total}，零测试残留）" \
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
printf '  %sP9 验收通过%s\n' "$G" "$N"
