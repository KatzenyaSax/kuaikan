#!/usr/bin/env bash
# P7 社群治理（管理员 / 封禁 / 编年史 / 内容权限联动）验收。
#
#   ./deploy/bin/verify-p7.sh              全量（L0 → L4）
#   ./deploy/bin/verify-p7.sh --layer l2   只跑某一层
#   ./deploy/bin/verify-p7.sh --fast       跳过浏览器层（L3）
#
# 分层：
#   L0 本地契约与配置   check-contract（30 码）/ check-openapi（77 operationId）/
#                       check-scripts / deploy-bin 全部 bash -n / web typecheck+lint+build /
#                       工作区干净（只在全量时查）/ 网关只把 history 与 admins/history
#                       两条 **GET** 放进白名单，7 个管理端点一个都没被顺带放行
#   L1 鉴权边界         游客可读 history 与 admins/history（HTTP 200 + code 0）；
#                       游客调 my-status / PUT / transfer / members / bans / 解封 →
#                       HTTP 401 + 40100；普通成员调全部管理端点 → HTTP 403 + 41007
#   L2 治理全链路       建社群自动写 COMMUNITY_CREATED、历代管理员第 1 任、存量老社群
#                       历史有回填；改信息（简介/头像外链/公告）生效、非法协议头像
#                       40010、无变动保存不新增 INFO_UPDATED；封禁在社成员（7 天+原因）：
#                       成员数 -1、进封禁名单、my-status banned=true、加入/发帖/评论
#                       全部 403+41006（文案带原因与解封时间）；封管理员 41008、非法
#                       时长 40010、封已退群者不误扣成员数且不可再加入；幂等解封（连解
#                       两次只写 1 条 MEMBER_UNBANNED）、解封后可重新加入并发帖；管理员
#                       删他人帖（原帖 404 + ES 文档清理）与删他人评论、普通成员删他人
#                       内容仍 403+40300；转让（自己/非成员/被封禁者 41009，成功交接后
#                       原管理员 41007 且可退群、新管理员获得权限、历任显示 2 任）；
#                       编年史 category=all|milestone|moderation 过滤准确、未知分类
#                       40010、跨分类复用游标 40010
#   L3 浏览器           web/e2e/p7-admin.mjs（游客社群页与历史页、普通成员见
#                       manage-forbidden、管理员改信息、帖子/评论快捷删帖删评与封禁作者、
#                       被封禁横幅与禁用加入按钮、解封后重新加入、二次确认转让、
#                       历史页两任管理员）
#   L4 破坏性故障隔离   停 community-service → 非作者删他人帖返受控 50300、作者删自己帖
#                       免查 community-service 正常成功 → 重启回 healthy → 管理员删帖恢复
#
# 顺序 L0 → L1 → L2 → L3 → L4：**L4 会停容器，必须最后跑**。
# trap 里保证无论怎么退出都会把 community-service 拉回来、并清理全部临时
# 账号 / 社群 / 帖子 / 评论 / 封禁 / 历史 / outbox / Redis 会话 / ES 文档。
#
# 断言纪律（P4/P5/P5.5/P6 反复踩出来的）：
#   每个「应该没有」的断言，前面必须先有「确实有」的断言。
#   删帖先证明 ES 里有这份文档，再断言删完没了；解封幂等先证明第一条
#   MEMBER_UNBANNED 真的落库了，"第二次不再写"才有意义。
#
# 本机 DNS 被代理接管（返回 fake-ip）时 curl 连不上站点：
#   SITE_RESOLVE=206.237.30.147 ./deploy/bin/verify-p7.sh --layer l3
# 会把 --resolve 加到所有站点请求上，并把同一个 IP 传给浏览器（E2E_SITE_IP）。
# 这条纯 IP 应急通道来自 ea2e4f1：nginx 为 206.237.30.147 单开 server 块，
# 因此 **Host 头仍必须是域名**——所以这里用的是 `--resolve`（保住 Host），
# 而不是把 SITE 换成 `https://206.237.30.147`（那样网关的路由匹配会变）。
#
# **不递归调用任何其他 verify 脚本**：P7 的回归由 verify-p3.sh 的 L5 覆盖，
# 这里再递归一次等于整套验收跑两遍。
set -uo pipefail

# 非交互 shell 的 PATH 里通常没有 node：L0 的 typecheck/lint/build 与 L3 的
# playwright 都要它。部署脚本 deploy-web.sh 走的是同一个目录。
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
ES_CT="${ES_CT:-kuaikan-elasticsearch-1}"
COMMUNITY_CT="${COMMUNITY_CT:-kuaikan-community-service-1}"
ES_URL="http://127.0.0.1:9200"

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,42p' "$0"; exit 0 ;;
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

printf '%s%s%s\n' "$B" "kuaikan · P7 社群治理验收" "$N"
info "站点 $SITE"
[ -n "$SITE_RESOLVE" ] && info "站点解析固定为 ${SITE_RESOLVE}（本机 DNS 走代理时必开）"
info "开始 $(date '+%F %T')"

# Bash 3.2 兼容：空数组展开在 set -u 下会炸，所以用字符串 + 有意不加引号的展开。
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
# 布尔一律输出小写 true/false（与 JSON 一致）：Python 的 str(False) 是 'False'，
# 直接比 'false' 会恒不相等，而且看起来像“后端没返回”。
if v is None: print('')
elif isinstance(v,bool): print('true' if v else 'false')
else: print(v)
" "$1" 2>/dev/null; }

enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

# 拼一个 JSON 对象：参数是成对的 key value。正文/原因里可能带引号与中文，
# 手写拼串会变成非法 JSON，报错点还指不到"是在验哪一条"。
json_obj() {
  python3 -c "
import json,sys
args=sys.argv[1:]
print(json.dumps({args[i]: args[i+1] for i in range(0,len(args),2)}))" "$@"
}

# 可选字段：值为空串时整对省略（durationDays 缺省 = 永久封禁，不能传空串）
json_obj_opt() {
  python3 -c "
import json,sys
args=sys.argv[1:]
d={}
for i in range(0,len(args),2):
    k,v=args[i],args[i+1]
    if v!='': d[k]=v
print(json.dumps(d))" "$@"
}

# mysql 客户端的默认字符集是 latin1：用 `SELECT name` 取中文会拿到一串 "?"。
# 本脚本要比对社群名与标题，所以两条 SQL 通道都显式指定 utf8mb4。
sql_exec() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p7-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p7-fixture.sql 2>/dev/null
    rm -f /tmp/p7-fixture.sql"
}

# 保留 stderr 的版本：只给清理用。sql_exec 把 stderr 吞掉，
# 多表 DELETE 的 `No database selected` 会变成静默失败（P5.5 踩过）。
sql_exec_v() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p7-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p7-fixture.sql 2>&1
    rm -f /tmp/p7-fixture.sql"
}

# 在 redis 容器里跑一段 shell 脚本。
# 必须 `sh -s` 从 stdin 喂进去：`docker exec ... sh /tmp/x.sh` 会去**容器里**找 /tmp。
redis_exec() {
  local b64
  b64=$(printf '%s\n' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p7-redis.sh
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-redis-1 sh -s < /tmp/p7-redis.sh
    rm -f /tmp/p7-redis.sh"
}

# 注意不要写成 `curl ... || echo 000`：curl 在连接失败时**也会**打印 000，
# 于是结果是 "000\n000"，和 "000" 的比较全部落空（P5.5 里踩过同样的形状）。
http_code() {
  local c
  c=$(site_curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-20}" "$1" 2>/dev/null)
  printf '%s' "${c:-000}"
}

api_get() {  # $1=url $2=token(可空)
  local token="${2:-}"
  if [ -n "$token" ]; then
    site_curl -s --max-time 20 "$1" -H "Authorization: Bearer $token"
  else
    site_curl -s --max-time 20 "$1"
  fi
}

api_post() {  # $1=url $2=token(可空) $3=body(可空)
  local token="${2:-}" body="${3:-}"
  if [ -n "$token" ] && [ -n "$body" ]; then
    site_curl -s --max-time 20 -X POST "$1" -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -d "$body"
  elif [ -n "$token" ]; then
    site_curl -s --max-time 20 -X POST "$1" -H "Authorization: Bearer $token"
  elif [ -n "$body" ]; then
    site_curl -s --max-time 20 -X POST "$1" -H 'Content-Type: application/json' -d "$body"
  else
    site_curl -s --max-time 20 -X POST "$1"
  fi
}

api_put() {  # $1=url $2=token $3=body
  site_curl -s --max-time 20 -X PUT "$1" -H "Authorization: Bearer $2" \
    -H 'Content-Type: application/json' -d "$3"
}

api_delete() {  # $1=url $2=token(可空) $3=body(可空)
  local token="${2:-}" body="${3:-}"
  if [ -n "$token" ] && [ -n "$body" ]; then
    site_curl -s --max-time 20 -X DELETE "$1" -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -d "$body"
  elif [ -n "$token" ]; then
    site_curl -s --max-time 20 -X DELETE "$1" -H "Authorization: Bearer $token"
  else
    site_curl -s --max-time 20 -X DELETE "$1"
  fi
}

# 一次调用同时拿到「HTTP 状态码」与「业务 code」：鉴权边界的断言必须两个都对
# ——只看业务 code 会漏掉"网关直接 401 且没有 body"这种形状，
# 只看 HTTP 会漏掉"HTTP 200 但 code 是 41007"。
call_http() {  # $1=方法 $2=url $3=token(可空) $4=body(可空) → "HTTP CODE"
  local method="$1" url="$2" token="${3:-}" body="${4:-}" tmp c b
  tmp=$(mktemp)
  local args=(-s -o "$tmp" -w '%{http_code}' --max-time 20 -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  c=$(site_curl "${args[@]}" 2>/dev/null)
  b=$(json_field 'code' < "$tmp" 2>/dev/null)
  rm -f "$tmp"
  printf '%s %s' "${c:-000}" "${b:--}"
}

expect_http_code() {  # $1=标签 $2=期望HTTP $3=期望code(- 表示不看) $4=call_http 结果
  local label="$1" eh="$2" ec="$3" res="$4" h b
  h=${res%% *}
  b=${res#* }
  if [ "$h" = "$eh" ] && { [ "$ec" = "-" ] || [ "$b" = "$ec" ]; }; then
    ok "$label"
  else
    ng "$label" "实得 HTTP ${h:-空} code=${b:-空}，期望 HTTP ${eh} code ${ec}"
  fi
}

# ---------------------------------------------------------------- ES / 容器

# ES 只在容器网络内：走 ES 容器自带的 curl（镜像里有，健康检查也在用）。
es_get() { ssh_run "docker exec $ES_CT curl -s --max-time 15 '$ES_URL$1'"; }

es_doc_found() {  # $1=postId → yes / no
  es_get "/post_read/_doc/$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('no'); raise SystemExit(0)
print('yes' if d.get('found') else 'no')" 2>/dev/null
}

es_count() { es_get '/post_read/_count' | json_field 'count'; }

svc_state() { ssh_run "docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $1 2>/dev/null"; }

wait_healthy() {  # $1=最多等多少秒（容器名用 ${SVC_CT}）
  local waited=0 st
  while [ "$waited" -lt "$1" ]; do
    st=$(ssh_run "docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $SVC_CT 2>/dev/null")
    [ "$st" = "healthy" ] && return 0
    sleep 5
    waited=$((waited+5))
  done
  return 1
}

ensure_community_up() {
  SVC_CT="$COMMUNITY_CT"
  ssh_run "docker start $COMMUNITY_CT >/dev/null 2>&1"
  wait_healthy 240
}

# ---------------------------------------------------------------- 等待收敛

wait_post_in_es() {  # $1=postId $2=最多等多少秒 → yes / no
  local waited=0 hit="no"
  while [ "$waited" -lt "$2" ]; do
    hit=$(es_doc_found "$1")
    [ "$hit" = "yes" ] && break
    sleep 1
    waited=$((waited+1))
  done
  printf '%s' "$hit"
}

wait_post_out_of_es() {  # $1=postId $2=最多等多少秒 → yes=已从索引消失 / no=还在
  local waited=0 found
  while [ "$waited" -lt "$2" ]; do
    found=$(es_doc_found "$1")
    if [ "$found" = "no" ]; then
      printf 'yes'
      return 0
    fi
    sleep 1
    waited=$((waited+1))
  done
  printf 'no'
}

# 等索引与库收敛。
#
# 为什么需要「多轮」：删行之后迟到的 MQ 重投仍可能把文档写回来（e2e 孤儿帖的成因），
# 所以收尾不能只重建一次：重建 → 再比一次 → 不齐再重建。
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

# 检索索引对不齐时用于诊断：把 e2e 相关文档 id 列出来
rebuild_index() {
  ssh_run "docker exec kuaikan-search-service-1 curl -s --max-time 90 -X POST http://127.0.0.1:8086/internal/admin/rebuild"
}

# ---------------------------------------------------------------- 夹具工具

# 密码 E2eFixture-Passw0rd 的 BCrypt 哈希（cost 10，与线上一致）。
# 这是**测试夹具**不是密钥：账号每次运行都不同且结束即删。
FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
CLEANUP_NEEDED=0
CLEANED=0
CS_STOPPED=0
P7_USER_IDS=""

mk_user() {  # $1=email $2=nickname → 输出 id
  sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$1', '$FIXTURE_HASH', '$2', 'USER', 1);
    SELECT id FROM kuaikan_user.t_user WHERE email='$1';" | sed -n '1p' | tr -d '\r\n '
}

login_token() {  # $1=email $2=password → accessToken
  api_post "$SITE/api/user/auth/login" "" "{\"email\":\"$1\",\"password\":\"$2\"}" | json_field 'data.accessToken'
}

remember_ids() {  # $1=现有 "a,b" $2=新 id
  if [ -n "${1:-}" ]; then printf '%s,%s' "$1" "$2"; else printf '%s' "$2"; fi
}

create_community() {  # $1=token $2=name → id
  api_post "$SITE/api/community/communities" "$1" "$(json_obj name "$2")" | json_field 'data.id'
}

join_community() {  # $1=token $2=name → 响应体
  api_post "$SITE/api/community/communities/$(enc "$2")/membership" "$1" ""
}

leave_community() {  # $1=token $2=name → 响应体
  api_delete "$SITE/api/community/communities/$(enc "$2")/membership" "$1" ""
}

create_post() {  # $1=token $2=communityId $3=title $4=body → id
  api_post "$SITE/api/content/posts" "$1" \
    "$(json_obj communityId "$2" title "$3" body "$4")" | json_field 'data.id'
}

create_comment() {  # $1=token $2=postId $3=body → id
  api_post "$SITE/api/content/posts/$2/comments" "$1" "$(json_obj body "$3")" | json_field 'data.id'
}

delete_post() { api_delete "$SITE/api/content/posts/$2" "$1" ""; }
delete_comment() { api_delete "$SITE/api/content/comments/$2" "$1" ""; }

update_info() {  # $1=token $2=name $3=description $4=avatarUrl $5=announcement
  api_put "$SITE/api/community/communities/$(enc "$2")" "$1" \
    "$(json_obj description "$3" avatarUrl "$4" announcement "$5")"
}

update_info_raw() {  # $1=token $2=name $3=body
  api_put "$SITE/api/community/communities/$(enc "$2")" "$1" "$3"
}

ban_member() {  # $1=token $2=name $3=userId $4=durationDays(可空=永久) $5=reason(可空)
  api_post "$SITE/api/community/communities/$(enc "$2")/bans" "$1" \
    "$(json_obj_opt userId "$3" durationDays "$4" reason "$5")"
}

unban_member() { api_delete "$SITE/api/community/communities/$(enc "$2")/bans/$3" "$1" ""; }

transfer_admin() {  # $1=token $2=name $3=targetUserId
  api_post "$SITE/api/community/communities/$(enc "$2")/transfer" "$1" \
    "$(json_obj targetUserId "$3")"
}

my_status() { api_get "$SITE/api/community/communities/$(enc "$2")/my-status" "$1"; }
history_url() { printf '%s/api/community/communities/%s/history' "$SITE" "$(enc "$1")"; }
history_of() {  # $1=name $2=category $3=limit $4=cursor(可空)
  local q="category=$2&limit=$3"
  [ -n "${4:-}" ] && q="$q&cursor=$(enc "$4")"
  api_get "$(history_url "$1")?$q" ""
}
admin_history() { api_get "$SITE/api/community/communities/$(enc "$1")/admins/history" ""; }
members_of() { api_get "$SITE/api/community/communities/$(enc "$2")/members?limit=${3:-50}" "$1"; }
bans_of() { api_get "$SITE/api/community/communities/$(enc "$2")/bans?limit=${3:-50}" "$1"; }
member_count() { api_get "$SITE/api/community/communities/$(enc "$1")" "" | json_field 'data.memberCount'; }

items_count() {  # $1=json → data.items 长度
  printf '%s' "$1" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['data'].get('items') or []))
except Exception: print(-1)" 2>/dev/null
}

items_field() {  # $1=json $2=字段 → 逗号连接
  printf '%s' "$1" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print(''); raise SystemExit(0)
def fmt(v):
    if v is None: return ''
    if isinstance(v,bool): return 'true' if v else 'false'
    return str(v)
print(','.join(fmt(i.get(sys.argv[1])) for i in items))" "$2" 2>/dev/null
}

event_count() {  # $1=json $2=eventType → 该类型的条数
  printf '%s' "$1" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print(-1); raise SystemExit(0)
print(sum(1 for i in items if i.get('eventType')==sys.argv[1]))" "$2" 2>/dev/null
}

cats_of() {  # $1=json → 去重后的 category 列表（逗号连接）
  printf '%s' "$1" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print(''); raise SystemExit(0)
print(','.join(sorted({str(i.get('category')) for i in items})))" 2>/dev/null
}

comment_deleted() {  # $1=postId $2=commentId → yes / no
  api_get "$SITE/api/content/posts/$1/comments?sort=time&limit=50" "" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
hit=[i for i in items if str(i.get('id'))==sys.argv[1]]
print('missing' if not hit else ('yes' if hit[0].get('deleted') else 'no'))" "$2" 2>/dev/null
}

# ---------------------------------------------------------------- 清理

cleanup() {
  [ "$CLEANED" = "1" ] && return 0

  # community-service 一定先拉回来：否则后续所有跨服务断言都会假红
  if [ "$CS_STOPPED" = "1" ]; then
    info "清理前先把 community-service 拉回来"
    ensure_community_up && CS_STOPPED=0
  fi

  local ids out
  ids=$(sql_exec "SELECT IFNULL(GROUP_CONCAT(id), 0) FROM kuaikan_user.t_user
      WHERE email LIKE 'e2e+p7%@kuaikan.test';" | tr -d '\r\n ')
  [ -z "$ids" ] && ids=0
  [ -z "$P7_USER_IDS" ] && P7_USER_IDS="$ids"

  # 多表 DELETE 必须在 USE 之后：`DELETE c FROM a c JOIN b ...` 在没选默认库时
  # 直接报 `No database selected`，而 sql_exec 把 stderr 丢掉了 ——
  # 于是"清理成功"是一句假话，测试数据会一直堆在库里。所以这里用 sql_exec_v。
  out=$(sql_exec_v "
    USE kuaikan_content;
    DELETE c FROM t_comment c
      JOIN t_post p ON p.id = c.post_id
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p7%';
    DELETE p FROM t_post p
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p7%';
    DELETE FROM t_outbox
      WHERE topic IN ('kuaikan_post_created', 'kuaikan_post_deleted')
        AND payload LIKE '%e2e-p7%';
    USE kuaikan_interaction;
    DELETE FROM t_interaction WHERE user_id IN ($ids);
    USE kuaikan_notification;
    DELETE FROM t_message WHERE user_id IN ($ids) OR actor_id IN ($ids);
    USE kuaikan_user;
    DELETE FROM t_user_follow WHERE follower_id IN ($ids) OR followee_id IN ($ids);
    DELETE FROM t_refresh_token WHERE user_id IN ($ids);
    DELETE FROM t_outbox WHERE topic = 'kuaikan_user_profile_updated' AND payload LIKE '%e2e-p7%';
    DELETE FROM t_user WHERE email LIKE 'e2e+p7%@kuaikan.test';
    USE kuaikan_community;
    DELETE b FROM t_community_ban b
      JOIN t_community c ON c.id = b.community_id
      WHERE c.name LIKE 'e2e-p7%';
    DELETE h FROM t_community_history h
      JOIN t_community c ON c.id = h.community_id
      WHERE c.name LIKE 'e2e-p7%';
    DELETE m FROM t_community_member m
      JOIN t_community c ON c.id = m.community_id
      WHERE c.name LIKE 'e2e-p7%';
    DELETE FROM t_community WHERE name LIKE 'e2e-p7%';")
  case "$out" in
    *ERROR*) printf '  %s清理失败%s %s\n' "$R" "$N" "$(printf '%s' "$out" | head -3 | tr '\n' ' ')" ;;
    *) [ "$CLEANUP_NEEDED" = "1" ] && info "已清理 P7 测试账号、社群、帖子、评论、封禁、历史与 outbox 事件" ;;
  esac

  # Redis：只删本次夹具 id 的 access jti，不做 `--scan auth:*` 全清（那会踢掉真实用户）。
  if [ "$CLEANUP_NEEDED" = "1" ] && [ "$ids" != "0" ]; then
    redis_exec "for uid in $(printf '%s' "$ids" | tr ',' ' '); do
      for jti in \$(redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZRANGE \"auth:user:\$uid:access\" 0 -1); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:session:\$jti\" >/dev/null
      done
      redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" DEL \"auth:user:\$uid:access\" >/dev/null
    done" >/dev/null 2>&1
  fi

  # ES 是派生存储：库里的行删掉后文档不会自己消失（事件已经发过了）。
  # 全量重建是最省事也最可信的收敛手段（幂等，且以库为准）。
  if [ "$CLEANUP_NEEDED" = "1" ] && settle_index; then
    info "已重建索引，清掉测试文档"
  fi

  CLEANED=1
}
trap cleanup EXIT

# ================================================================ L0 本地契约与配置

if want_layer l0; then
  section "L0 本地契约与配置"

  out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1)
  if [ $? = 0 ] && printf '%s' "$out" | grep -q '30 个错误码'; then
    ok "错误码契约三方一致（30 码）"
  else
    ng "错误码契约不一致" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"
  fi

  out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1)
  if [ $? = 0 ] && printf '%s' "$out" | grep -q '77 个'; then
    ok "OpenAPI 与网关放行规则一致（77 个 operationId）"
  else
    ng "OpenAPI 与放行规则不一致" "$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
  fi

  out=$(node "$APP_DIR/deploy/bin/check-scripts.mjs" 2>&1) \
    && ok "shell 脚本静态检查通过（含本脚本）" \
    || ng "shell 脚本静态检查" "$(printf '%s' "$out" | sed -n '2p')"

  # bash -n 只查语法：语法错误（少 fi / 少 done）会立刻红。
  syntax_bad=""
  for f in "$APP_DIR"/deploy/bin/*.sh; do
    bash -n "$f" 2>/dev/null || syntax_bad="$syntax_bad $(basename "$f")"
  done
  [ -z "$syntax_bad" ] && ok "deploy/bin 下全部脚本 bash -n 通过" || ng "脚本语法错误" "$syntax_bad"

  # P7 的四个新错误码：验收脚本假定它们存在，这里先证明它们真的登记了
  missing_codes=""
  for code in 41006 41007 41008 41009; do
    grep -qE "\"code\": $code([^0-9]|$)" "$APP_DIR/contract/error-codes.json" || missing_codes="$missing_codes $code"
  done
  [ -z "$missing_codes" ] && ok "P7 的 4 个错误码已登记（41006~41009）" \
    || ng "错误码契约缺项" "$missing_codes"

  # 网关白名单：只放行两条 GET，管理端点一条都不能被顺带放行。
  gw="$APP_DIR/services/gateway/src/main/resources/application.yml"
  whitelist_ok=1
  for pat in 'GET ^/api/community/communities/[^/]+/history$' \
             'GET ^/api/community/communities/[^/]+/admins/history$'; do
    grep -Fq "$pat" "$gw" || whitelist_ok=0
  done
  [ "$whitelist_ok" = "1" ] && ok "编年史与历代管理员两条 GET 在网关白名单里" \
    || ng "网关白名单缺少编年史/历代管理员规则"

  leaked=""
  for pat in '/my-status' '/transfer' '/members' '/bans'; do
    if grep -E '^\s+- (GET|POST|PUT|DELETE) ' "$gw" | grep -q -- "$pat"; then
      leaked="$leaked $pat"
    fi
  done
  [ -z "$leaked" ] && ok "7 个管理端点都没有进白名单（my-status/transfer/members/bans）" \
    || ng "白名单误放行了管理端点" "$leaked"

  # 迁移文件必须在库里：V2 是 P7 的表结构与历史回填
  mig="$APP_DIR/services/community-service/src/main/resources/db/migration/V2__community_admin_governance.sql"
  if [ -f "$mig" ] \
    && grep -q 't_community_ban' "$mig" \
    && grep -q 't_community_history' "$mig" \
    && grep -q 'COMMUNITY_CREATED' "$mig"; then
    ok "V2 迁移含封禁表、历史表与存量社群回填"
  else
    ng "V2 迁移缺失或不完整"
  fi

  if [ -d "$WEB_DIR/node_modules" ] && command -v node >/dev/null 2>&1; then
    ( cd "$WEB_DIR" && npm run typecheck >/dev/null 2>&1 ) \
      && ok "web typecheck 通过" || ng "web typecheck 失败"
    ( cd "$WEB_DIR" && npm run lint >/dev/null 2>&1 ) \
      && ok "web lint 通过" || ng "web lint 失败"
    ( cd "$WEB_DIR" && npm run build >/dev/null 2>&1 ) \
      && ok "web build 通过" || ng "web build 失败"
  else
    skip "web typecheck / lint / build" "缺少 web/node_modules 或 node"
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

# ================================================================ L1 鉴权边界

L1_READY=0
L1_STEP=""

prepare_l1() {
  [ "$L1_READY" = "1" ] && return 0
  L1_STEP="SSH"
  ssh_run 'true' || return 1

  L1_ADMIN_EMAIL="e2e+p7l1a${STAMP}@kuaikan.test"
  L1_MEMBER_EMAIL="e2e+p7l1m${STAMP}@kuaikan.test"
  L1_COMMUNITY="e2e-p7-l1-${STAMP}"

  L1_STEP="建管理员与成员账号"
  L1_ADMIN_ID=$(mk_user "$L1_ADMIN_EMAIL" "e2e-p7-l1-admin-${STAMP}")
  L1_MEMBER_ID=$(mk_user "$L1_MEMBER_EMAIL" "e2e-p7-l1-member-${STAMP}")
  [ -n "$L1_ADMIN_ID" ] && [ -n "$L1_MEMBER_ID" ] || return 1
  CLEANUP_NEEDED=1
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L1_ADMIN_ID")
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L1_MEMBER_ID")

  L1_STEP="账号登录"
  L1_ADMIN_T=$(login_token "$L1_ADMIN_EMAIL" "$FIXTURE_PASS")
  L1_MEMBER_T=$(login_token "$L1_MEMBER_EMAIL" "$FIXTURE_PASS")
  [ -n "$L1_ADMIN_T" ] && [ -n "$L1_MEMBER_T" ] || return 1

  L1_STEP="建社群并让普通成员加入"
  L1_COMMUNITY_ID=$(create_community "$L1_ADMIN_T" "$L1_COMMUNITY")
  [ -n "$L1_COMMUNITY_ID" ] || return 1
  join_community "$L1_MEMBER_T" "$L1_COMMUNITY" >/dev/null

  info "L1 夹具：管理员=${L1_ADMIN_ID} 成员=${L1_MEMBER_ID} 社群=${L1_COMMUNITY_ID}"
  L1_STEP=""
  L1_READY=1
  return 0
}

if want_layer l1; then
  section "L1 鉴权边界（游客 401 / 普通成员 403+41007）"

  if ! prepare_l1; then
    ng "创建 L1 夹具失败" "失败在：${L1_STEP:-未知}"
  else
    base="$SITE/api/community/communities/$(enc "$L1_COMMUNITY")"

    # ---------------- 游客可读：编年史与历代管理员
    res=$(call_http GET "$(history_url "$L1_COMMUNITY")?category=all&limit=5" "" "")
    expect_http_code "游客可读社群编年史（HTTP 200 + code 0）" 200 0 "$res"
    body=$(history_of "$L1_COMMUNITY" all 5 "")
    n=$(items_count "$body")
    [ "${n:-0}" -ge 1 ] 2>/dev/null && ok "游客拿到的编年史里至少有建社记录（${n} 条）" \
      || ng "游客拿到的编年史是空的" "$(printf '%s' "$body" | head -c 120)"

    res=$(call_http GET "$base/admins/history" "" "")
    expect_http_code "游客可读历代管理员（HTTP 200 + code 0）" 200 0 "$res"
    body=$(admin_history "$L1_COMMUNITY")
    [ "$(items_count "$body")" = "1" ] && ok "游客拿到的历代管理员是第 1 任（现任）" \
      || ng "历代管理员条数不对" "实得 $(items_count "$body")"

    # ---------------- 游客调管理端点：一律 401 + 40100
    guest_bad=""
    while IFS='|' read -r label method url body; do
      [ -z "$label" ] && continue
      res=$(call_http "$method" "$url" "" "$body")
      h=${res%% *}
      b=${res#* }
      if [ "$h" = "401" ] && [ "$b" = "40100" ]; then :; else
        guest_bad="$guest_bad ${label}(HTTP ${h}/code ${b})"
      fi
    done <<EOF
my-status|GET|$base/my-status|
PUT-改信息|PUT|$base|{"description":"x"}
transfer|POST|$base/transfer|{"targetUserId":"1"}
members|GET|$base/members|
bans-列表|GET|$base/bans|
bans-封禁|POST|$base/bans|{"userId":"1","durationDays":7}
bans-解封|DELETE|$base/bans/1|
EOF
    [ -z "$guest_bad" ] && ok "游客调 7 个管理端点全部 HTTP 401 + 40100" \
      || ng "游客调管理端点没有被拦成 401" "$guest_bad"

    # ---------------- 普通成员（在社但不是 owner）：403 + 41007
    res=$(call_http GET "$base/my-status" "$L1_MEMBER_T" "")
    expect_http_code "普通成员可以读 my-status（200，admin=false）" 200 0 "$res"
    body=$(my_status "$L1_MEMBER_T" "$L1_COMMUNITY")
    [ "$(printf '%s' "$body" | json_field 'data.admin')" = "false" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.joined')" = "true" ] \
      && ok "my-status 对普通成员返回 joined=true、admin=false" \
      || ng "my-status 对普通成员的返回不对" "$(printf '%s' "$body" | head -c 120)"

    member_bad=""
    while IFS='|' read -r label method url body; do
      [ -z "$label" ] && continue
      res=$(call_http "$method" "$url" "$L1_MEMBER_T" "$body")
      h=${res%% *}
      b=${res#* }
      if [ "$h" = "403" ] && [ "$b" = "41007" ]; then :; else
        member_bad="$member_bad ${label}(HTTP ${h}/code ${b})"
      fi
    done <<EOF
PUT-改信息|PUT|$base|{"description":"hack"}
transfer|POST|$base/transfer|{"targetUserId":"1"}
members|GET|$base/members|
bans-列表|GET|$base/bans|
bans-封禁|POST|$base/bans|{"userId":"1","durationDays":7}
bans-解封|DELETE|$base/bans/1|
EOF
    [ -z "$member_bad" ] && ok "普通成员调 6 个管理端点全部 HTTP 403 + 41007" \
      || ng "普通成员调管理端点没有被拦成 41007" "$member_bad"

    # 管理员拿同样的端点必须通：证明上面的 403 是权限判定，不是端点不通
    res=$(call_http GET "$base/members" "$L1_ADMIN_T" "")
    expect_http_code "管理员读成员名单成功（反向证明端点本身可用）" 200 0 "$res"
  fi
fi

# ================================================================ L2 治理全链路

L2_READY=0
L2_STEP=""

prepare_l2() {
  [ "$L2_READY" = "1" ] && return 0
  L2_STEP="SSH"
  ssh_run 'true' || return 1

  L2_ADMIN_EMAIL="e2e+p7l2a${STAMP}@kuaikan.test"
  L2_B_EMAIL="e2e+p7l2b${STAMP}@kuaikan.test"
  L2_C_EMAIL="e2e+p7l2c${STAMP}@kuaikan.test"
  L2_D_EMAIL="e2e+p7l2d${STAMP}@kuaikan.test"
  L2_ADMIN_NICK="e2e-p7-l2-admin-${STAMP}"
  L2_B_NICK="e2e-p7-l2-b-${STAMP}"
  L2_C_NICK="e2e-p7-l2-c-${STAMP}"
  L2_D_NICK="e2e-p7-l2-d-${STAMP}"
  L2_COMMUNITY="e2e-p7-l2-${STAMP}"
  L2_TOKEN="p7l2e2e${STAMP}"

  L2_STEP="建四个测试账号"
  L2_ADMIN_ID=$(mk_user "$L2_ADMIN_EMAIL" "$L2_ADMIN_NICK")
  L2_B_ID=$(mk_user "$L2_B_EMAIL" "$L2_B_NICK")
  L2_C_ID=$(mk_user "$L2_C_EMAIL" "$L2_C_NICK")
  L2_D_ID=$(mk_user "$L2_D_EMAIL" "$L2_D_NICK")
  [ -n "$L2_ADMIN_ID" ] && [ -n "$L2_B_ID" ] && [ -n "$L2_C_ID" ] && [ -n "$L2_D_ID" ] || return 1
  CLEANUP_NEEDED=1
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L2_ADMIN_ID")
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L2_B_ID")
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L2_C_ID")
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L2_D_ID")

  L2_STEP="账号登录"
  L2_A_T=$(login_token "$L2_ADMIN_EMAIL" "$FIXTURE_PASS")
  L2_B_T=$(login_token "$L2_B_EMAIL" "$FIXTURE_PASS")
  L2_C_T=$(login_token "$L2_C_EMAIL" "$FIXTURE_PASS")
  L2_D_T=$(login_token "$L2_D_EMAIL" "$FIXTURE_PASS")
  [ -n "$L2_A_T" ] && [ -n "$L2_B_T" ] && [ -n "$L2_C_T" ] && [ -n "$L2_D_T" ] || return 1

  info "L2 夹具：管理员=${L2_ADMIN_ID} B=${L2_B_ID} C=${L2_C_ID} D=${L2_D_ID} 关键词=${L2_TOKEN}"
  L2_STEP=""
  L2_READY=1
  return 0
}

if want_layer l2; then
  section "L2 治理全链路"

  if ! prepare_l2; then
    ng "创建 L2 夹具失败" "失败在：${L2_STEP:-未知}"
  else
    l2base="$SITE/api/community/communities/$(enc "$L2_COMMUNITY")"

    # ---------------- 建社群 → 自动生成 COMMUNITY_CREATED
    created=$(api_post "$SITE/api/community/communities" "$L2_A_T" "$(json_obj name "$L2_COMMUNITY")")
    L2_CID=$(printf '%s' "$created" | json_field 'data.id')
    if [ -n "$L2_CID" ]; then
      ok "建社群成功（${L2_COMMUNITY}）"
    else
      ng "建社群失败" "$(printf '%s' "$created" | head -c 120)"
    fi

    if [ -n "$L2_CID" ]; then
      h=$(history_of "$L2_COMMUNITY" all 50 "")
      [ "$(event_count "$h" COMMUNITY_CREATED)" = "1" ] \
        && ok "建社自动写入 COMMUNITY_CREATED（同事务）" \
        || ng "建社后编年史里没有 COMMUNITY_CREATED" "$(printf '%s' "$h" | head -c 160)"

      ah=$(admin_history "$L2_COMMUNITY")
      [ "$(items_count "$ah")" = "1" ] \
        && [ "$(items_field "$ah" userId)" = "$L2_ADMIN_ID" ] \
        && [ "$(items_field "$ah" current)" = "true" ] \
        && ok "历代管理员显示第 1 任（创建者，current=true）" \
        || ng "历代管理员第 1 任不对" "实得 $(items_count "$ah") 条 / $(items_field "$ah" userId)"

      # 存量老社群：created_at **早于 V2 迁移**的社群，历史只可能来自回填
      old_name=$(sql_exec "SELECT c.name FROM kuaikan_community.t_community c
          JOIN kuaikan_community.flyway_schema_history f ON f.version='2'
          WHERE c.status=1 AND c.created_at < f.installed_on AND c.name NOT LIKE 'e2e-%'
          ORDER BY c.created_at ASC LIMIT 1;" | tr -d '\r\n')
      if [ -z "$old_name" ]; then
        skip "存量老社群历史回填" "库里没有早于 V2 迁移的社群"
      else
        oh=$(history_of "$old_name" all 50 "")
        oah=$(admin_history "$old_name")
        if [ "$(event_count "$oh" COMMUNITY_CREATED)" -ge 1 ] 2>/dev/null \
          && [ "$(items_count "$oah")" -ge 1 ] 2>/dev/null; then
          ok "存量老社群「${old_name}」的历史由 V2 回填（有创建记录与第 1 任）"
        else
          ng "存量老社群没有回填历史" "${old_name}：events=$(items_count "$oh") terms=$(items_count "$oah")"
        fi
      fi
    fi

    # ---------------- 改社群信息
    desc1="e2e P7 简介 ${L2_TOKEN}"
    ann1="e2e P7 公告 ${L2_TOKEN}"
    avatar1="https://example.com/p7-${L2_TOKEN}.png"
    body=$(update_info "$L2_A_T" "$L2_COMMUNITY" "$desc1" "$avatar1" "$ann1")
    if [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.description')" = "$desc1" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.avatarUrl')" = "$avatar1" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.announcement')" = "$ann1" ]; then
      ok "管理员改简介 / 头像外链 / 公告成功（响应即更新后的详情）"
    else
      ng "改社群信息失败" "$(printf '%s' "$body" | head -c 160)"
    fi

    detail=$(api_get "$SITE/api/community/communities/$(enc "$L2_COMMUNITY")" "")
    [ "$(printf '%s' "$detail" | json_field 'data.announcement')" = "$ann1" ] \
      && ok "游客读到的社群详情带上了新公告（公开读路径同步生效）" \
      || ng "社群详情没有新公告" "$(printf '%s' "$detail" | head -c 160)"

    body=$(update_info_raw "$L2_A_T" "$L2_COMMUNITY" '{"avatarUrl":"ftp://evil/p7.png"}')
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "非法协议头像（ftp://）被拒 → 40010" || ng "非法协议头像没有被拒"

    body=$(update_info_raw "$L2_A_T" "$L2_COMMUNITY" '{"avatarUrl":"javascript:alert(1)"}')
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "javascript: 伪协议头像被拒 → 40010" || ng "javascript: 头像没有被拒"

    # 无变动保存：历史条数必须一模一样（INFO_UPDATED 不新增）
    hist_before=$(items_count "$(history_of "$L2_COMMUNITY" all 50 "")")
    body=$(update_info "$L2_A_T" "$L2_COMMUNITY" "$desc1" "$avatar1" "$ann1")
    hist_after=$(items_count "$(history_of "$L2_COMMUNITY" all 50 "")")
    if [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] && [ "$hist_before" = "$hist_after" ]; then
      ok "无变动的保存不新增 INFO_UPDATED（历史条数 ${hist_before} 不变）"
    else
      ng "无变动保存仍写了历史" "before=${hist_before:-空} after=${hist_after:-空}"
    fi

    # ---------------- 成员加入与内容准备
    join_community "$L2_B_T" "$L2_COMMUNITY" >/dev/null
    join_community "$L2_C_T" "$L2_COMMUNITY" >/dev/null
    join_community "$L2_D_T" "$L2_COMMUNITY" >/dev/null
    count=$(member_count "$L2_COMMUNITY")
    [ "$count" = "4" ] && ok "三个成员加入后成员数为 4（含创建者）" \
      || ng "成员数不对" "实得 ${count:-空}"

    L2_P_A=$(create_post "$L2_A_T" "$L2_CID" "e2e P7 ${L2_TOKEN} 管理员帖" "e2e P7 管理员正文")
    L2_P_C=$(create_post "$L2_C_T" "$L2_CID" "e2e P7 ${L2_TOKEN} 将被管理员删的帖" "e2e P7 C 正文")
    [ -n "$L2_P_A" ] && [ -n "$L2_P_C" ] && ok "管理员与成员 C 各发一帖" \
      || ng "发帖失败" "A=${L2_P_A:-空} C=${L2_P_C:-空}"

    # 两条评论都挂在**不会被删的** P_A 上：帖子被删后评论列表会一起 404，
    # 那条路径无法验证「tombstone 占位」，会把断言落在错误的原因上。
    L2_CMT_A=$(create_comment "$L2_A_T" "$L2_P_A" "e2e P7 管理员自己的评论")
    L2_CMT_C=$(create_comment "$L2_C_T" "$L2_P_A" "e2e P7 C 的评论")
    [ -n "$L2_CMT_A" ] && [ -n "$L2_CMT_C" ] && ok "管理员与成员 C 各留一条评论（都在 P_A 上）" \
      || ng "发评论失败" "A=${L2_CMT_A:-空} C=${L2_CMT_C:-空}"

    # ---------------- 管理员删他人帖：先证明文档在 ES 里
    if [ -n "$L2_P_C" ]; then
      in_es=$(wait_post_in_es "$L2_P_C" 20)
      [ "$in_es" = "yes" ] && ok "待删帖已进 ES 索引（后面「删完消失」才有意义）" \
        || ng "待删帖 20s 内没进 ES 索引，删帖同步断言会失去前提"

      body=$(delete_post "$L2_A_T" "$L2_P_C")
      [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
        && ok "管理员删除他人帖子成功（非作者，靠 admin 放行）" \
        || ng "管理员删他人帖失败" "$(printf '%s' "$body" | head -c 160)"

      code=$(http_code "$SITE/api/content/posts/$L2_P_C")
      [ "$code" = "404" ] && ok "被删帖子的详情接口返回 404" || ng "被删帖子仍可读" "HTTP ${code:-000}"

      gone=$(wait_post_out_of_es "$L2_P_C" 20)
      [ "$gone" = "yes" ] && ok "ES 里那份文档已同步清理（PostDeleted 事件通）" \
        || ng "ES 里残留已删帖的文档" "$L2_P_C"
    fi

    # ---------------- 管理员删他人评论
    #
    # 删除策略是「有回复就 tombstone、没回复就物理删」（CommentService.remove），
    # 所以先让 B 回复 C 的评论：不这样构造，只能断言到“行不见了”，
    # 那和“删评论”看上去没区别，占位与计数这两件事根本没被验到。
    if [ -n "$L2_CMT_C" ]; then
      L2_REPLY=$(api_post "$SITE/api/content/posts/$L2_P_A/comments" "$L2_B_T" \
        "$(json_obj body 'e2e P7 B 对 C 的回复' replyToCommentId "$L2_CMT_C")" | json_field 'data.id')
      [ -n "$L2_REPLY" ] && ok "B 回复 C 的评论（为 tombstone 占位准备子回复）" \
        || ng "B 回复 C 的评论失败"

      st_before=$(comment_deleted "$L2_P_A" "$L2_CMT_C")
      [ "$st_before" = "no" ] && ok "待删评论先确实存在（tombstone 断言的前提）" \
        || ng "待删评论一开始就不可见" "实得 ${st_before:-空}"
      cmt_before=$(api_get "$SITE/api/content/posts/$L2_P_A" "" | json_field 'data.commentCount')

      body=$(delete_comment "$L2_A_T" "$L2_CMT_C")
      [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
        && ok "管理员删除他人评论成功" || ng "管理员删他人评论失败" "$(printf '%s' "$body" | head -c 160)"
      st=$(comment_deleted "$L2_P_A" "$L2_CMT_C")
      [ "$st" = "yes" ] && ok "有回复的评论被删后留成「已删除」占位（tombstone）" \
        || ng "被删评论的状态不对" "实得 ${st:-空}"
      cmt_after=$(api_get "$SITE/api/content/posts/$L2_P_A" "" | json_field 'data.commentCount')
      [ -n "$cmt_before" ] && [ "$cmt_after" = "$((cmt_before - 1))" ] \
        && ok "删评论同时扣减了帖子评论数（${cmt_before} → ${cmt_after}）" \
        || ng "删评论后 commentCount 不对" "before=${cmt_before:-空} after=${cmt_after:-空}"
    fi

    # ---------------- 普通成员删他人内容：403 + 40300
    res=$(call_http GET "$SITE/api/content/posts/$L2_P_A" "" "")
    expect_http_code "普通成员删帖前：目标帖确实存在（先证有，再证删不掉）" 200 0 "$res"
    res=$(call_http DELETE "$SITE/api/content/posts/$L2_P_A" "$L2_B_T" "")
    expect_http_code "普通成员删他人帖子 → HTTP 403 + 40300" 403 40300 "$res"
    res=$(call_http DELETE "$SITE/api/content/comments/$L2_CMT_A" "$L2_B_T" "")
    expect_http_code "普通成员删他人评论 → HTTP 403 + 40300" 403 40300 "$res"
    code=$(http_code "$SITE/api/content/posts/$L2_P_A")
    [ "$code" = "200" ] && ok "普通成员删帖失败后原帖仍在（403 不是删了一半）" \
      || ng "普通成员删帖失败后原帖消失了" "HTTP ${code:-000}"
    st=$(comment_deleted "$L2_P_A" "$L2_CMT_A")
    [ "$st" = "no" ] && ok "普通成员删评失败后那条评论仍在（403 不是删了一半）" \
      || ng "普通成员删评失败后评论状态变了" "实得 ${st:-空}"

    # ---------------- 封禁已退群成员 D：先退群，再封
    leave_community "$L2_D_T" "$L2_COMMUNITY" >/dev/null
    count=$(member_count "$L2_COMMUNITY")
    [ "$count" = "3" ] && ok "D 退群后成员数为 3" || ng "D 退群后成员数不对" "实得 ${count:-空}"

    # ---------------- 封禁在社成员 C（7 天 + 原因）
    L2_BAN_REASON="e2e P7 发布广告 ${L2_TOKEN}"
    body=$(ban_member "$L2_A_T" "$L2_COMMUNITY" "$L2_C_ID" 7 "$L2_BAN_REASON")
    if [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.userId')" = "$L2_C_ID" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.reason')" = "$L2_BAN_REASON" ] \
      && [ -n "$(printf '%s' "$body" | json_field 'data.expiresAt')" ]; then
      ok "封禁在社成员 C 成功（7 天 + 原因 + 到期时间）"
    else
      ng "封禁成员失败" "$(printf '%s' "$body" | head -c 160)"
    fi

    count=$(member_count "$L2_COMMUNITY")
    [ "$count" = "2" ] && ok "封禁在社成员后成员数 -1（3 → 2）" || ng "封禁没有扣减成员数" "实得 ${count:-空}"

    body=$(bans_of "$L2_A_T" "$L2_COMMUNITY")
    [ "$(items_field "$body" userId)" = "$L2_C_ID" ] \
      && ok "封禁名单里能查到 C（生效中的封禁）" \
      || ng "封禁名单里没有 C" "实得 $(items_field "$body" userId)"

    st=$(my_status "$L2_C_T" "$L2_COMMUNITY")
    if [ "$(printf '%s' "$st" | json_field 'data.banned')" = "true" ] \
      && [ "$(printf '%s' "$st" | json_field 'data.joined')" = "false" ] \
      && [ "$(printf '%s' "$st" | json_field 'data.banReason')" = "$L2_BAN_REASON" ] \
      && [ -n "$(printf '%s' "$st" | json_field 'data.bannedUntil')" ]; then
      ok "my-status 对 C 返回 banned=true / joined=false / 原因 / 解封时间"
    else
      ng "my-status 的封禁字段不对" "$(printf '%s' "$st" | head -c 160)"
    fi

    res=$(call_http POST "$l2base/membership" "$L2_C_T" "")
    expect_http_code "被封禁用户尝试加入社群 → HTTP 403 + 41006" 403 41006 "$res"
    body=$(join_community "$L2_C_T" "$L2_COMMUNITY")
    msg=$(printf '%s' "$body" | json_field 'message')
    case "$msg" in
      *"$L2_BAN_REASON"*) ok "41006 文案里带上了封禁原因" ;;
      *) ng "41006 文案里没有封禁原因" "${msg:-空}" ;;
    esac
    case "$msg" in
      *"解封时间"*) ok "41006 文案里带上了「解封时间」" ;;
      *) ng "41006 文案里没有解封时间" "${msg:-空}" ;;
    esac

    res=$(call_http POST "$SITE/api/content/posts" "$L2_C_T" \
      "$(json_obj communityId "$L2_CID" title "e2e P7 ${L2_TOKEN} 被封禁后发帖" body "x")")
    expect_http_code "被封禁用户发帖 → HTTP 403 + 41006" 403 41006 "$res"
    res=$(call_http POST "$SITE/api/content/posts/$L2_P_A/comments" "$L2_C_T" '{"body":"被封禁还想评论"}')
    expect_http_code "被封禁用户评论 → HTTP 403 + 41006" 403 41006 "$res"

    # ---------------- 封禁参数边界
    body=$(ban_member "$L2_A_T" "$L2_COMMUNITY" "$L2_ADMIN_ID" 7 "")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41008" ] \
      && ok "封禁管理员本人 → 41008（HTTP 200 的业务规则）" \
      || ng "封禁管理员本人没有被拒" "$(printf '%s' "$body" | head -c 160)"

    body=$(ban_member "$L2_A_T" "$L2_COMMUNITY" "$L2_B_ID" 5 "非法时长")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "封禁时长 5 天（白名单外）→ 40010" || ng "非法封禁时长没有被拒"

    # ---------------- 封禁已退群成员 D：不误扣成员数 + 不可再加入
    body=$(ban_member "$L2_A_T" "$L2_COMMUNITY" "$L2_D_ID" "" "退群逃避")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "封禁已退群成员 D 成功（永久封禁，防退群逃避）" \
      || ng "封禁已退群成员失败" "$(printf '%s' "$body" | head -c 160)"
    count=$(member_count "$L2_COMMUNITY")
    [ "$count" = "2" ] && ok "封禁已退群成员不会误扣成员数（仍为 2）" \
      || ng "封禁已退群成员把成员数扣错了" "实得 ${count:-空}"
    res=$(call_http POST "$l2base/membership" "$L2_D_T" "")
    expect_http_code "已退群被封禁的 D 无法再加入 → HTTP 403 + 41006" 403 41006 "$res"

    # ---------------- 幂等解封
    h_before=$(history_of "$L2_COMMUNITY" moderation 50 "")
    unb_before=$(event_count "$h_before" MEMBER_UNBANNED)
    body=$(unban_member "$L2_A_T" "$L2_COMMUNITY" "$L2_C_ID")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] && ok "解封 C 成功" \
      || ng "解封失败" "$(printf '%s' "$body" | head -c 160)"
    body=$(unban_member "$L2_A_T" "$L2_COMMUNITY" "$L2_C_ID")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "重复解封幂等（第二次仍 code 0，不报错）" || ng "第二次解封报错了"
    h_after=$(history_of "$L2_COMMUNITY" moderation 50 "")
    unb_after=$(event_count "$h_after" MEMBER_UNBANNED)
    if [ "${unb_before:-0}" = "0" ] && [ "$unb_after" = "1" ]; then
      ok "连解两次只写 1 条 MEMBER_UNBANNED（幂等，且第一条真的落库了）"
    else
      ng "解封历史条数不对" "before=${unb_before:-空} after=${unb_after:-空}"
    fi
    body=$(bans_of "$L2_A_T" "$L2_COMMUNITY")
    printf '%s' "$(items_field "$body" userId)" | grep -q "$L2_C_ID" \
      && ng "解封后 C 仍在封禁名单里" "实得 $(items_field "$body" userId)" \
      || ok "解封后 C 已从生效封禁名单消失"

    st=$(my_status "$L2_C_T" "$L2_COMMUNITY")
    [ "$(printf '%s' "$st" | json_field 'data.banned')" = "false" ] \
      && ok "解封后 my-status 的 banned 变回 false" || ng "解封后 my-status 仍是 banned"

    # 解封只是解封：成员行已经在封禁时被移出，所以「能重新加入」才是正确路径
    rejoin=$(join_community "$L2_C_T" "$L2_COMMUNITY" | json_field 'code')
    [ "$rejoin" = "0" ] && ok "解封后 C 可以重新加入社群（封禁是临时的，不是永久拉黑）" \
      || ng "解封后 C 重新加入失败" "code=${rejoin:-空}"
    L2_P_C2=$(create_post "$L2_C_T" "$L2_CID" "e2e P7 ${L2_TOKEN} 解封后重新加入的帖" "x")
    [ -n "$L2_P_C2" ] && ok "重新加入后 C 可以正常发帖（41006 不再拦住）" \
      || ng "解封并重新加入后 C 仍发不了帖"

    # ---------------- 转让
    body=$(transfer_admin "$L2_A_T" "$L2_COMMUNITY" "$L2_ADMIN_ID")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41009" ] \
      && ok "转让给自己 → 41009" || ng "转让给自己没有被拒" "$(printf '%s' "$body" | head -c 120)"

    body=$(transfer_admin "$L2_A_T" "$L2_COMMUNITY" "999999999999999999")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41009" ] \
      && ok "转让给非成员 → 41009" || ng "转让给非成员没有被拒" "$(printf '%s' "$body" | head -c 120)"

    body=$(transfer_admin "$L2_A_T" "$L2_COMMUNITY" "$L2_D_ID")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41009" ] \
      && ok "转让给被封禁用户（已退群的 D）→ 41009" \
      || ng "转让给被封禁用户没有被拒" "$(printf '%s' "$body" | head -c 120)"

    # 转让给在社成员 B：需要 B 现在仍在社
    join_community "$L2_B_T" "$L2_COMMUNITY" >/dev/null
    body=$(transfer_admin "$L2_A_T" "$L2_COMMUNITY" "$L2_B_ID")
    if [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && [ "$(printf '%s' "$body" | json_field 'data.ownerId')" = "$L2_B_ID" ]; then
      ok "转让给在社成员 B 成功（ownerId 立即变成新管理员）"
    else
      ng "转让失败" "$(printf '%s' "$body" | head -c 160)"
    fi

    res=$(call_http GET "$l2base/members" "$L2_A_T" "")
    expect_http_code "转让后原管理员失去管理权（读成员 → 403 + 41007）" 403 41007 "$res"
    res=$(call_http PUT "$l2base" "$L2_A_T" '{"description":"原管理员还想改"}')
    expect_http_code "转让后原管理员改信息 → 403 + 41007" 403 41007 "$res"
    res=$(call_http GET "$l2base/members" "$L2_B_T" "")
    expect_http_code "转让后新管理员获得管理权（读成员 → 200）" 200 0 "$res"

    body=$(leave_community "$L2_A_T" "$L2_COMMUNITY")
    if [ "$(printf '%s' "$body" | json_field 'code')" = "0" ]; then
      ok "转让后原管理员可以成功退群（不再被 41005 挡住）"
    else
      ng "转让后原管理员仍退不了群" "$(printf '%s' "$body" | head -c 160)"
    fi

    ah=$(admin_history "$L2_COMMUNITY")
    if [ "$(items_count "$ah")" = "2" ] \
      && [ "$(items_field "$ah" userId)" = "$L2_ADMIN_ID,$L2_B_ID" ] \
      && [ "$(items_field "$ah" current)" = "false,true" ]; then
      ok "历代管理员显示 2 任交接脉络（第 1 任已卸任、第 2 任现任）"
    else
      ng "历代管理员脉络不对" "实得 $(items_count "$ah") 条 / $(items_field "$ah" userId) / $(items_field "$ah" current)"
    fi

    # ---------------- 编年史分类过滤
    h_all=$(history_of "$L2_COMMUNITY" all 50 "")
    h_mile=$(history_of "$L2_COMMUNITY" milestone 50 "")
    h_mod=$(history_of "$L2_COMMUNITY" moderation 50 "")

    cats_all=$(cats_of "$h_all")
    if [ "$cats_all" = "MILESTONE,MODERATION" ]; then
      ok "category=all 同时包含大事记与治理记录（${cats_all}）"
    else
      ng "category=all 的分类不全" "实得 ${cats_all:-空}"
    fi
    [ "$(cats_of "$h_mile")" = "MILESTONE" ] && ok "category=milestone 只返回大事记" \
      || ng "milestone 过滤不准确" "实得 $(cats_of "$h_mile")"
    [ "$(cats_of "$h_mod")" = "MODERATION" ] && ok "category=moderation 只返回治理记录" \
      || ng "moderation 过滤不准确" "实得 $(cats_of "$h_mod")"

    if [ "$(event_count "$h_mile" COMMUNITY_CREATED)" -ge 1 ] 2>/dev/null \
      && [ "$(event_count "$h_mile" ADMIN_TRANSFERRED)" -ge 1 ] 2>/dev/null \
      && [ "$(event_count "$h_mile" INFO_UPDATED)" -ge 1 ] 2>/dev/null; then
      ok "大事记含 建社 / 改信息 / 管理员转让 三类事件"
    else
      ng "大事记缺事件" "实得 $(items_field "$h_mile" eventType)"
    fi
    if [ "$(event_count "$h_mod" MEMBER_BANNED)" -ge 1 ] 2>/dev/null \
      && [ "$(event_count "$h_mod" MEMBER_UNBANNED)" = "1" ] 2>/dev/null; then
      ok "治理记录含 2 次封禁（C 与 D）与 1 次解封"
    else
      ng "治理记录事件条数不对" "实得 $(items_field "$h_mod" eventType)"
    fi

    body=$(history_of "$L2_COMMUNITY" bogus 10 "")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "未知 category → 40010（不静默降级成 all）" || ng "未知 category 被接受"

    cursor=$(history_of "$L2_COMMUNITY" all 1 "" | json_field 'data.nextCursor')
    if [ -z "$cursor" ]; then
      ng "第一页没有返回 nextCursor，跨分类游标断言无法验证"
    else
      body=$(history_of "$L2_COMMUNITY" moderation 1 "$cursor")
      [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
        && ok "把 all 的游标喂给 moderation → 40010（游标绑定分类）" \
        || ng "跨分类复用游标被接受了" "$(printf '%s' "$body" | head -c 120)"
    fi
  fi
fi

# ================================================================ L3 浏览器

L3_READY=0
L3_STEP=""

prepare_l3() {
  [ "$L3_READY" = "1" ] && return 0
  L3_STEP="SSH"
  ssh_run 'true' || return 1

  L3_ADMIN_EMAIL="e2e+p7l3a${STAMP}@kuaikan.test"
  L3_MEMBER_EMAIL="e2e+p7l3m${STAMP}@kuaikan.test"
  L3_ADMIN_NICK="e2e-p7-l3-admin-${STAMP}"
  L3_MEMBER_NICK="e2e-p7-l3-member-${STAMP}"
  L3_COMMUNITY="e2e-p7-l3-${STAMP}"
  L3_TOKEN="p7l3e2e${STAMP}"

  L3_STEP="建管理员与成员账号"
  L3_ADMIN_ID=$(mk_user "$L3_ADMIN_EMAIL" "$L3_ADMIN_NICK")
  L3_MEMBER_ID=$(mk_user "$L3_MEMBER_EMAIL" "$L3_MEMBER_NICK")
  [ -n "$L3_ADMIN_ID" ] && [ -n "$L3_MEMBER_ID" ] || return 1
  CLEANUP_NEEDED=1
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L3_ADMIN_ID")
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L3_MEMBER_ID")

  L3_STEP="账号登录"
  L3_ADMIN_T=$(login_token "$L3_ADMIN_EMAIL" "$FIXTURE_PASS")
  L3_MEMBER_T=$(login_token "$L3_MEMBER_EMAIL" "$FIXTURE_PASS")
  [ -n "$L3_ADMIN_T" ] && [ -n "$L3_MEMBER_T" ] || return 1

  L3_STEP="建社群并设置初始公告"
  L3_COMMUNITY_ID=$(create_community "$L3_ADMIN_T" "$L3_COMMUNITY")
  [ -n "$L3_COMMUNITY_ID" ] || return 1
  L3_ANNOUNCEMENT_INIT="e2e P7 初始公告 ${L3_TOKEN}"
  L3_DESC_INIT="e2e P7 初始简介 ${L3_TOKEN}"
  update_info "$L3_ADMIN_T" "$L3_COMMUNITY" "$L3_DESC_INIT" "" "$L3_ANNOUNCEMENT_INIT" >/dev/null

  L3_STEP="成员加入并发帖留评论"
  join_community "$L3_MEMBER_T" "$L3_COMMUNITY" >/dev/null
  L3_POST_TITLE="e2e P7 ${L3_TOKEN} 待治理的帖"
  L3_POST_ID=$(create_post "$L3_MEMBER_T" "$L3_COMMUNITY_ID" "$L3_POST_TITLE" "e2e P7 待治理正文")
  [ -n "$L3_POST_ID" ] || return 1
  L3_COMMENT="e2e P7 ${L3_TOKEN} 待治理评论"
  create_comment "$L3_MEMBER_T" "$L3_POST_ID" "$L3_COMMENT" >/dev/null

  info "L3 夹具：管理员=${L3_ADMIN_ID} 成员=${L3_MEMBER_ID} 社群=${L3_COMMUNITY_ID} 帖=${L3_POST_ID}"
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
      E2E_SCRIPT="$WEB_DIR/e2e/p7-admin.mjs"
      if [ ! -f "$E2E_SCRIPT" ]; then
        ng "浏览器脚本不存在" "$E2E_SCRIPT"
      elif out=$(cd "$WEB_DIR" && SITE="$SITE" E2E_SITE_IP="$SITE_RESOLVE" \
            E2E_ADMIN_EMAIL="$L3_ADMIN_EMAIL" E2E_ADMIN_PASSWORD="$FIXTURE_PASS" \
            E2E_MEMBER_EMAIL="$L3_MEMBER_EMAIL" E2E_MEMBER_PASSWORD="$FIXTURE_PASS" \
            E2E_ADMIN_NICK="$L3_ADMIN_NICK" E2E_MEMBER_NICK="$L3_MEMBER_NICK" \
            E2E_COMMUNITY="$L3_COMMUNITY" E2E_COMMUNITY_ID="$L3_COMMUNITY_ID" \
            E2E_POST_ID="$L3_POST_ID" E2E_POST_TITLE="$L3_POST_TITLE" \
            E2E_COMMENT="$L3_COMMENT" E2E_ANNOUNCEMENT_INIT="$L3_ANNOUNCEMENT_INIT" \
            E2E_TOKEN="$L3_TOKEN" \
            node e2e/p7-admin.mjs 2>&1); then
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

# ================================================================ L4 破坏性故障隔离

L4_READY=0
L4_STEP=""

prepare_l4() {
  [ "$L4_READY" = "1" ] && return 0
  L4_STEP="SSH"
  ssh_run 'true' || return 1

  L4_ADMIN_EMAIL="e2e+p7l4a${STAMP}@kuaikan.test"
  L4_MEMBER_EMAIL="e2e+p7l4m${STAMP}@kuaikan.test"
  L4_COMMUNITY="e2e-p7-l4-${STAMP}"
  L4_TOKEN="p7l4e2e${STAMP}"

  L4_STEP="建管理员与成员账号"
  L4_ADMIN_ID=$(mk_user "$L4_ADMIN_EMAIL" "e2e-p7-l4-admin-${STAMP}")
  L4_MEMBER_ID=$(mk_user "$L4_MEMBER_EMAIL" "e2e-p7-l4-member-${STAMP}")
  [ -n "$L4_ADMIN_ID" ] && [ -n "$L4_MEMBER_ID" ] || return 1
  CLEANUP_NEEDED=1
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L4_ADMIN_ID")
  P7_USER_IDS=$(remember_ids "$P7_USER_IDS" "$L4_MEMBER_ID")

  L4_STEP="账号登录"
  L4_ADMIN_T=$(login_token "$L4_ADMIN_EMAIL" "$FIXTURE_PASS")
  L4_MEMBER_T=$(login_token "$L4_MEMBER_EMAIL" "$FIXTURE_PASS")
  [ -n "$L4_ADMIN_T" ] && [ -n "$L4_MEMBER_T" ] || return 1

  L4_STEP="建社群并发帖"
  L4_COMMUNITY_ID=$(create_community "$L4_ADMIN_T" "$L4_COMMUNITY")
  [ -n "$L4_COMMUNITY_ID" ] || return 1
  join_community "$L4_MEMBER_T" "$L4_COMMUNITY" >/dev/null

  # P1 由成员写（管理员是非作者，删它会触发跨服务权限查询）
  L4_P1=$(create_post "$L4_MEMBER_T" "$L4_COMMUNITY_ID" "e2e P7 ${L4_TOKEN} 成员的帖" "x")
  # P2 由管理员写（作者删自己免查 community-service）
  L4_P2=$(create_post "$L4_ADMIN_T" "$L4_COMMUNITY_ID" "e2e P7 ${L4_TOKEN} 管理员自己的帖" "x")
  [ -n "$L4_P1" ] && [ -n "$L4_P2" ] || return 1

  info "L4 夹具：管理员=${L4_ADMIN_ID} 成员=${L4_MEMBER_ID} 社群=${L4_COMMUNITY_ID} 帖=${L4_P1}/${L4_P2}"
  L4_STEP=""
  L4_READY=1
  return 0
}

if want_layer l4; then
  section "L4 破坏性故障隔离（停 community-service → 恢复）"

  if ! prepare_l4; then
    ng "创建 L4 夹具失败" "失败在：${L4_STEP:-未知}"
  else
    # 0. 先证明「产生路径确实通」：没有这条，后面的 50300 可能只是因为帖子本来就删不掉
    res=$(call_http GET "$SITE/api/content/posts/$L4_P1" "" "")
    expect_http_code "停容器前：成员的目标帖可读（200）" 200 0 "$res"
    res=$(call_http GET "$SITE/api/community/communities/$(enc "$L4_COMMUNITY")/my-status" "$L4_ADMIN_T" "")
    expect_http_code "停容器前：community-service 在（my-status 200）" 200 0 "$res"

    # 1. 停 community-service
    ssh_run "docker stop $COMMUNITY_CT >/dev/null 2>&1"
    case "$(svc_state "$COMMUNITY_CT")" in
      exited*) CS_STOPPED=1 ;;
      *) CS_STOPPED=0 ;;
    esac
    if [ "$CS_STOPPED" = "1" ]; then
      ok "community-service 已停止（故障注入成功）"
    else
      ng "停不掉 community-service，故障隔离无法验证" "$(svc_state "$COMMUNITY_CT")"
    fi

    if [ "$CS_STOPPED" = "1" ]; then
      # 2. 非作者删他人帖：下游不可用 → 受控 50300，绝不"查不到权限就放行"
      code=000
      body_code=""
      waited=0
      for _ in $(seq 1 15); do
        res=$(call_http DELETE "$SITE/api/content/posts/$L4_P1" "$L4_ADMIN_T" "")
        code=${res%% *}
        body_code=${res#* }
        [ "$code" = "503" ] && [ "$body_code" = "50300" ] && break
        sleep 2
        waited=$((waited+2))
      done
      if [ "$code" = "503" ] && [ "$body_code" = "50300" ]; then
        ok "community-service 停机时非作者删他人帖 → HTTP 503 + 50300（受控降级，${waited}s 内）"
      else
        ng "非作者删他人帖的降级不符合契约" "实得 HTTP ${code:-000} code=${body_code:-空}"
      fi

      code=$(http_code "$SITE/api/content/posts/$L4_P1")
      [ "$code" = "200" ] && ok "降级失败后目标帖仍在（50300 不是静默删掉）" \
        || ng "降级时目标帖状态变了" "HTTP ${code:-000}"

      # 3. 作者删自己：免查 community-service，必须正常成功
      body=$(delete_post "$L4_ADMIN_T" "$L4_P2")
      if [ "$(printf '%s' "$body" | json_field 'code')" = "0" ]; then
        ok "作者删自己的帖子在 community-service 停机时仍成功（免跨服务查询）"
      else
        ng "作者删自己的帖子被下游故障拖累" "$(printf '%s' "$body" | head -c 160)"
      fi
      code=$(http_code "$SITE/api/content/posts/$L4_P2")
      [ "$code" = "404" ] && ok "作者删掉的帖子详情已 404" || ng "作者删帖后仍可读" "HTTP ${code:-000}"

      # 主站读路径不受影响
      hc=$(http_code "$SITE/")
      [ "$hc" = "200" ] && ok "community-service 停机时首页仍可访问（HTTP 200）" \
        || ng "community-service 停机时首页挂了" "HTTP ${hc:-000}"

      # 4. 起回来并等 healthy
      ensure_community_up
      if [ "$(svc_state "$COMMUNITY_CT")" = "running healthy" ]; then
        CS_STOPPED=0
        ok "community-service 已恢复 running/healthy"
      else
        ng "community-service 起来了但没到 healthy" "$(svc_state "$COMMUNITY_CT")"
      fi

      # 5. 恢复后同一条删帖路径必须真的通（证明 50300 不是"永远 50300"）
      if [ "$CS_STOPPED" = "0" ]; then
        body_code=""
        waited=0
        for _ in $(seq 1 15); do
          body=$(delete_post "$L4_ADMIN_T" "$L4_P1")
          body_code=$(printf '%s' "$body" | json_field 'code')
          [ "$body_code" = "0" ] && break
          sleep 2
          waited=$((waited+2))
        done
        if [ "$body_code" = "0" ]; then
          ok "恢复后管理员删他人帖成功（跨服务权限查询恢复，${waited}s 内）"
        else
          ng "恢复后管理员仍删不掉他人帖" "code=${body_code:-空}"
        fi
        code=$(http_code "$SITE/api/content/posts/$L4_P1")
        [ "$code" = "404" ] && ok "恢复后删掉的帖子详情 404" || ng "恢复后删帖没有生效" "HTTP ${code:-000}"
      fi
    fi

    # 6. 清理并核验零残留
    CLEANUP_NEEDED=1
    cleanup
    sleep 1

    ids="$P7_USER_IDS"
    [ -z "$ids" ] && ids=0

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user WHERE email LIKE 'e2e+p7%@kuaikan.test';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试账号已全部删除" || ng "残留测试账号" "${n:-空} 行"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post p
        JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-p7%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试帖子已清理" || ng "残留测试帖" "${n:-空}"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_comment c
        JOIN kuaikan_content.t_post p ON p.id = c.post_id
        JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-p7%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试评论已清理" || ng "残留测试评论" "${n:-空}"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_community.t_community WHERE name LIKE 'e2e-p7%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试社群已清理" || ng "残留测试社群" "${n:-空}"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_community.t_community_ban;" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "t_community_ban 已清空（零封禁残留）" || ng "t_community_ban 有残留" "${n:-空} 行"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_community.t_community_history h
        JOIN kuaikan_community.t_community c ON c.id = h.community_id
        WHERE c.name LIKE 'e2e-p7%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试社群的历史记录已清理" || ng "残留历史记录" "${n:-空}"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_outbox
        WHERE topic IN ('kuaikan_post_created','kuaikan_post_deleted') AND payload LIKE '%e2e-p7%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "outbox 里的测试事件已清理" || ng "残留 outbox 事件" "${n:-空}"

    left=$(redis_exec "for uid in $(printf '%s' "$ids" | tr ',' ' '); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZCARD \"auth:user:\$uid:access\"
      done" | tr -d '\r' | awk '{s+=$1} END{print s+0}')
    [ "$ids" = "0" ] && left=0
    [ "${left:-1}" = "0" ] && ok "Redis 里的测试会话已清空" || ng "残留 Redis 会话" "${left:-空}"

    # ES 是派生存储：库删干净了，文档要靠重建收敛。
    db_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
    es_total=$(es_count)
    [ -n "$es_total" ] && [ "$es_total" = "$db_count" ] \
      && ok "清理后索引文档数与 MySQL 有效帖数一致（${es_total}，无 e2e 文档残留）" \
      || ng "清理后索引里仍有残留文档" "ES=${es_total:-空} 库=${db_count:-空}"

    latest=$(api_get "$SITE/api/content/posts/latest?limit=50" "")
    residue=$(printf '%s' "$latest" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data'] or []
except Exception: print('bad'); raise SystemExit(0)
bad=[p.get('title') for p in d if str(p.get('title') or '').startswith('e2e')]
print(';'.join(bad[:3]) if bad else 'none')" 2>/dev/null)
    [ "$residue" = "none" ] && ok "线上最新帖没有 e2e 残留（首页干净）" || ng "最新帖有 e2e 残留" "$residue"

    hc=$(http_code "$SITE/")
    [ "$hc" = "200" ] && ok "线上首页可访问（HTTP 200）" || ng "线上首页不可访问" "HTTP ${hc:-000}"

    # 破坏性层跑完必须确认容器回到健康状态，否则下一次验收全是红的
    out=$(ssh_run 'for c in gateway user-service community-service content-service interaction-service \
        notification-service search-service rank-service elasticsearch mysql redis nacos rmq-namesrv rmq-broker; do
        printf "%s=%s\n" "$c" "$(docker inspect -f "{{.State.Health.Status}}" "kuaikan-$c-1" 2>/dev/null)"
      done')
    unhealthy=""
    for name in gateway user-service community-service content-service interaction-service \
                notification-service search-service rank-service elasticsearch mysql redis nacos rmq-namesrv rmq-broker; do
      st=$(printf '%s\n' "$out" | grep "^${name}=" | head -1 | cut -d= -f2)
      [ "$st" = "healthy" ] || unhealthy="$unhealthy ${name}(${st:-unknown})"
    done
    [ -z "$unhealthy" ] && ok "验收结束后 14 个容器全部 healthy" || ng "验收结束后有容器不健康" "$unhealthy"
  fi
fi

# ================================================================ 汇总

printf '\n%s汇总%s\n' "$B" "$N"
printf '  通过 %d   失败 %d   跳过 %d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s失败项：%s\n' "$R" "$N"
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  exit 1
fi
printf '  %sP7 验收通过%s\n' "$G" "$N"
