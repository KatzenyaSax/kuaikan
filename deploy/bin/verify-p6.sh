#!/usr/bin/env bash
# P6 全文搜索（Elasticsearch + IK）验收。
#
#   ./deploy/bin/verify-p6.sh              全量（L0 → L4）
#   ./deploy/bin/verify-p6.sh --layer l2   只跑某一层
#   ./deploy/bin/verify-p6.sh --fast       跳过浏览器层（L3）
#
# 分层：
#   L0 本地契约与配置   bash -n / check-contract / check-openapi / check-scripts、
#                       compose.yml 里 elasticsearch 不映射宿主机端口、
#                       网关对 /api/search/posts 是**精准白名单**（P6.4）而不是通配
#   L1 基础设施与重建   14 个容器 healthy、IK 插件就绪且中文分词正确、3 个搜索 topic
#                       存在且消费组无积压、POST /internal/admin/rebuild 成功、
#                       索引文档数 == MySQL status=1 帖数、post_read/post_write 同指
#   L2 增删改同步与双面检索
#                       发帖 → 秒级进 ES（标题 / 高亮占位符 / 社群名 / 作者昵称）→
#                       改昵称 → 历史帖 authorNickname 同步且新昵称可搜 →
#                       删帖 → 对外搜不到且 ES 文档消失；
#                       对外排序 / 社群筛选 / 游标不重不漏 / 跨排序游标与空 q → 40010；
#                       对内按 authorId / 昵称 / 社群名 / 关键词 / 时间过滤 + includeBody；
#                       公网访问 /internal/search/posts 与 /api/search/internal/search/posts 不可达
#   L3 浏览器          e2e-p6.mjs（顶栏跳转、<mark> 渲染无裸 HTML、排序切换、
#                       社群筛选、空态、点结果进详情）
#   L4 破坏性故障隔离   停 ES → search-service 仍 running/healthy、对外 503 / 50300、
#                       主站发帖与首页浏览完全正常；起 ES → 搜索恢复；
#                       重建收敛后清理夹具并断言无残留
#
# 顺序 L0 → L1 → L2 → L3 → L4：**L4 会停容器，必须最后跑**。
# trap 里保证无论怎么退出都会把 ES 拉回来（否则下一次跑 L1 全是红的）。
#
# 断言纪律（P4/P5/P5.5 踩出来的）：
#   每个「应该没有」的断言，前面必须先有「确实有」的断言。
#   L2 的删帖断言先证明发帖能搜到；L4 的 503 断言先证明 ES 在时是 200。
#   否则空响应 / 404 / 零数据会让断言恒绿——看起来全过其实什么都没测。
#
# 各层各用一套夹具：L2 会改昵称、删帖，L3 的浏览器流程要吃同一份数据，
# 共用一套时后跑的层必然踩前一层的残留（P4.4 / P5 的「单层跑过、全量跑红」）。
#
# 本机 DNS 被代理接管（返回 fake-ip）时 curl 连不上站点：
#   SITE_RESOLVE=206.237.30.147 ./deploy/bin/verify-p6.sh --layer l3
# 会把 --resolve 加到所有站点请求上，并把同一个 IP 传给浏览器（E2E_SITE_IP）。
#
# **不递归调用任何其他 verify 脚本**：P6 的回归由 verify-p3.sh 的 L5 覆盖，
# 这里再递归一次等于整套验收跑两遍。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SITE_HOST="${SITE_HOST:-$(printf '%s' "$SITE" | sed -e 's|^https\{0,1\}://||' -e 's|/.*$||')}"
SITE_RESOLVE="${SITE_RESOLVE:-}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"
COMPOSE_FILE="$APP_DIR/deploy/compose/compose.yml"
MQ_BIN="${MQ_BIN:-/home/rocketmq/rocketmq-5.3.4/bin/mqadmin}"
MQ_NAMESRV="${MQ_NAMESRV:-rmq-namesrv:9876}"
ES_CT="${ES_CT:-kuaikan-elasticsearch-1}"
SEARCH_CT="${SEARCH_CT:-kuaikan-search-service-1}"
SEARCH_PORT="${SEARCH_PORT:-8086}"
ES_URL="http://127.0.0.1:9200"

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
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

printf '%s%s%s\n' "$B" "kuaikan · P6 全文搜索验收" "$N"
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
print('' if v is None else v)
" "$1" 2>/dev/null; }

enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

# mysql 客户端的默认字符集是 latin1：用 `SELECT title` 取中文会拿到一串 "?"
# （数据本身是对的，坏在连接上）。L1 的"重建后检索探针"要拿中文标题当关键词，
# 所以两条 SQL 通道都显式指定 utf8mb4。
sql_exec() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p6-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p6-fixture.sql 2>/dev/null
    rm -f /tmp/p6-fixture.sql"
}

# 保留 stderr 的版本：只给清理用。sql_exec 把 stderr 吞掉，
# 多表 DELETE 的 `No database selected` 会变成静默失败（P5.5 踩过）。
sql_exec_v() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p6-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 -N < /tmp/p6-fixture.sql 2>&1
    rm -f /tmp/p6-fixture.sql"
}

# 在 redis 容器里跑一段 shell 脚本。
# 必须 `sh -s` 从 stdin 喂进去：`docker exec ... sh /tmp/x.sh` 会去**容器里**找 /tmp，
# 而脚本写在宿主机上，那里没有这个文件。
redis_exec() {
  local b64
  b64=$(printf '%s\n' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p6-redis.sh
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-redis-1 sh -s < /tmp/p6-redis.sh
    rm -f /tmp/p6-redis.sh"
}

# 注意不要写成 `curl ... || echo 000`：curl 在连接失败时**也会**打印 000，
# 于是结果是 "000\n000"，和 "000" 的比较全部落空（P5.5 里踩过同样的形状）。
http_code() {
  local c
  c=$(site_curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-20}" "$1" 2>/dev/null)
  printf '%s' "${c:-000}"
}

# POST 的状态码（对内端点做「公网不可达」探测时需要带方法）
http_code_post() {  # $1=url $2=body
  local c
  c=$(site_curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$1" \
    -H 'Content-Type: application/json' -d "$2" 2>/dev/null)
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

api_post() {  # $1=url $2=token(可空) $3=body
  local token="${2:-}"
  if [ -n "$token" ]; then
    site_curl -s --max-time 20 -X POST "$1" -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -d "$3"
  else
    site_curl -s --max-time 20 -X POST "$1" -H 'Content-Type: application/json' -d "$3"
  fi
}

api_patch() {  # $1=url $2=token $3=body
  site_curl -s --max-time 20 -X PATCH "$1" -H "Authorization: Bearer $2" \
    -H 'Content-Type: application/json' -d "$3"
}

api_delete() {  # $1=url $2=token
  site_curl -s --max-time 20 -X DELETE "$1" -H "Authorization: Bearer $2"
}

# ---------------------------------------------------------------- ES / 内部端点

# ES 只在容器网络内：走 ES 容器自带的 curl（镜像里有，健康检查也在用）。
es_get() {  # $1=路径
  ssh_run "docker exec $ES_CT curl -s --max-time 15 '$ES_URL$1'"
}

# 带 JSON body 的 ES 调用。body 用 base64 过一层，避免引号/中文在 ssh 里被吃掉。
es_api() {  # $1=方法 $2=路径 $3=可选 JSON
  local method="$1" path="$2" body="${3:-}" b64
  if [ -n "$body" ]; then
    b64=$(printf '%s' "$body" | base64 | tr -d '\n')
    ssh_run "printf '%s' '$b64' | base64 -d > /tmp/p6-es.json
      docker exec -i $ES_CT curl -s --max-time 15 -X $method '$ES_URL$path' \
        -H 'Content-Type: application/json' --data-binary @- < /tmp/p6-es.json
      rm -f /tmp/p6-es.json"
  else
    ssh_run "docker exec $ES_CT curl -s --max-time 15 -X $method '$ES_URL$path'"
  fi
}

# 在某个服务容器里打内网端口（对内端点只能这么调）。
svc_call() {  # $1=容器名 $2=curl 参数串 $3=可选 JSON body
  local container="$1" args="$2" body="${3:-}" b64
  if [ -n "$body" ]; then
    b64=$(printf '%s' "$body" | base64 | tr -d '\n')
    ssh_run "printf '%s' '$b64' | base64 -d > /tmp/p6-body.json
      docker exec -i $container curl -s --max-time 60 $args \
        -H 'Content-Type: application/json' --data-binary @- < /tmp/p6-body.json
      rm -f /tmp/p6-body.json"
  else
    ssh_run "docker exec $container curl -s --max-time 60 $args"
  fi
}

internal_search() {  # $1=可选 JSON
  local body="${1:-}"
  [ -z "$body" ] && body='{}'
  svc_call "$SEARCH_CT" "-X POST http://127.0.0.1:${SEARCH_PORT}/internal/search/posts" "$body"
}

rebuild_index() { svc_call "$SEARCH_CT" "-X POST http://127.0.0.1:${SEARCH_PORT}/internal/admin/rebuild"; }

es_reachable() { es_get '/_cluster/health' | grep -q '"status"'; }

# 公网能不能拿到「站点根下的 /internal/**」？
#
# nginx 里根本没有这条路由：
#   - GET 落到 SPA 回退 → 200 + text/html（就是 index.html，393 字节，不是接口）
#   - 其他方法 → 405（静态文件不接受该方法）
# 两种都说明公网拿不到内部接口。但**必须排除**"真的是 search-service 的 JSON"，
# 所以不能只看状态码：200 还要验 content-type 与 doctype。
# （P6.5a 只写了 404|405，第一次全量就在这里假红：SPA 回退是 200。）
internal_probe() {  # $1=GET|POST → ok | ok-spa | leak:<status>
  local method="$1" tmp out status ctype body
  tmp=$(mktemp)
  if [ "$method" = "POST" ]; then
    out=$(site_curl -s -o "$tmp" -w '%{http_code} %{content_type}' --max-time 20 -X POST \
      "$SITE/internal/search/posts" -H 'Content-Type: application/json' -d '{"keyword":"x"}')
  else
    out=$(site_curl -s -o "$tmp" -w '%{http_code} %{content_type}' --max-time 20 \
      "$SITE/internal/search/posts")
  fi
  status=${out%% *}
  ctype=${out#* }
  body=$(head -c 32 "$tmp" 2>/dev/null | tr '[:upper:]' '[:lower:]')
  rm -f "$tmp"
  case "$status" in
    404|405) printf 'ok' ;;
    200)
      case "$ctype$body" in
        *html*'<!doctype html>'*) printf 'ok-spa' ;;
        *) printf 'leak:%s' "$status" ;;
      esac ;;
    *) printf 'leak:%s' "${status:-000}" ;;
  esac
}

probe_ok() {  # internal_probe 的结果是不是「拿不到接口」
  case "$1" in ok|ok-spa) return 0 ;; *) return 1 ;; esac
}

es_doc_found() {  # $1=postId → yes / no
  es_get "/post_read/_doc/$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('no'); raise SystemExit(0)
print('yes' if d.get('found') else 'no')" 2>/dev/null
}

es_doc_field() {  # $1=postId $2=_source 下的字段
  es_get "/post_read/_doc/$1" | python3 -c "
import json,sys
try: v=json.load(sys.stdin).get('_source',{}).get(sys.argv[1])
except Exception: print(''); raise SystemExit(0)
print('' if v is None else v)" "$2" 2>/dev/null
}

es_count() { es_get '/post_read/_count' | json_field 'count'; }

svc_state() { ssh_run "docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $1 2>/dev/null"; }

wait_es_healthy() {  # $1=最多等多少秒
  local waited=0 st
  while [ "$waited" -lt "$1" ]; do
    st=$(ssh_run "docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $ES_CT 2>/dev/null")
    [ "$st" = "healthy" ] && return 0
    sleep 5
    waited=$((waited+5))
  done
  return 1
}

ensure_es_up() {
  ssh_run "docker start $ES_CT >/dev/null 2>&1"
  wait_es_healthy 240
}

# ---------------------------------------------------------------- 检索断言工具

search_url() { printf '%s/api/search/posts?%s' "$SITE" "$1"; }

search_ids() {  # $1=query 串（已编码） → 逗号分隔的 postId
  api_get "$(search_url "$1")" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print(''); raise SystemExit(0)
print(','.join(str(i.get('postId')) for i in items))" 2>/dev/null
}

item_field() {  # $1=query 串 $2=postId $3=字段（点路径） → 该条目的字段值
  api_get "$(search_url "$1")" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print(''); raise SystemExit(0)
target=None
for i in items:
    if str(i.get('postId')) == sys.argv[1]: target=i
if target is None: print(''); raise SystemExit(0)
v=target
for k in sys.argv[2].split('.'):
    if isinstance(v,dict) and k in v: v=v[k]
    else: print(''); raise SystemExit(0)
print('' if v is None else v)" "$2" "$3" 2>/dev/null
}

next_cursor() {  # $1=query 串 → data.nextCursor（可能为空）
  api_get "$(search_url "$1")" | json_field 'data.nextCursor'
}

# 等索引与库收敛。
#
# 为什么需要「多轮」：ES 停机期间的 PostCreated 事件在 broker 里**还没消失**，
# 消费重投的时间表不受我们控制。库里删掉行 + 重建索引之后，
# 一次迟到的重投仍可能把已删掉的文档写回来（就是 AGENTS.md 警告的 e2e 孤儿帖）。
# 所以收尾不能只重建一次：重建 → 再查一次 → 脏了再重建，直到干净。
settle_index() {  # $1=关键词 → 0 表示索引里干净了
  local round ids
  for round in 1 2 3; do
    ids=$(search_ids "q=$(enc "$1")&limit=10")
    [ -z "$ids" ] && return 0
    rebuild_index >/dev/null 2>&1
    sleep 2
    ids=$(search_ids "q=$(enc "$1")&limit=10")
    [ -z "$ids" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------- 夹具工具

# 密码 E2eFixture-Passw0rd 的 BCrypt 哈希（cost 10，与线上一致）。
# 这是**测试夹具**不是密钥：账号每次运行都不同且结束即删。
FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
XSS_MARK='<img src=x onerror="window.__p6xss=1">'
CLEANUP_NEEDED=0
CLEANED=0
ES_STOPPED=0
P6_USER_IDS=""
P6_POST_IDS=""

mk_user() {  # $1=email $2=nickname → 输出 id
  sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$1', '$FIXTURE_HASH', '$2', 'USER', 1);
    SELECT id FROM kuaikan_user.t_user WHERE email='$1';" | sed -n '1p' | tr -d '\r\n '
}

login_token() {  # $1=email $2=password → accessToken
  api_post "$SITE/api/user/auth/login" "" "{\"email\":\"$1\",\"password\":\"$2\"}" | json_field 'data.accessToken'
}

create_community() {  # $1=token $2=name → id
  api_post "$SITE/api/community/communities" "$1" \
    "$(json_obj name "$2")" | json_field 'data.id'
}

create_post() {  # $1=token $2=communityId $3=title $4=body → id
  api_post "$SITE/api/content/posts" "$1" \
    "$(json_obj communityId "$2" title "$3" body "$4")" | json_field 'data.id'
}

patch_nickname() {  # $1=token $2=nickname
  api_patch "$SITE/api/user/auth/me" "$1" "$(json_obj nickname "$2")"
}

delete_post() {  # $1=token $2=postId
  api_delete "$SITE/api/content/posts/$2" "$1"
}

remember_ids() {  # $1=现有 "a,b" $2=新 id
  if [ -n "${1:-}" ]; then printf '%s,%s' "$1" "$2"; else printf '%s' "$2"; fi
}

# 拼一个 JSON 对象：参数是成对的 key value。
#
# 为什么不用手写 `{"body":"$3"}`：正文里可能带双引号（L3 的 XSS 字面量就是
# `<img ... onerror="...">`）。手写拼串会变成非法 JSON，服务端直接 40010，
# 而报错点完全指不到“是在验 XSS”。交给 json.dumps，顺带把中文转成 \uXXXX，
# 整个请求体都是 ASCII，过 shell / ssh 不会再有编码问题。
json_obj() {
  python3 -c "
import json,sys
args=sys.argv[1:]
print(json.dumps({args[i]: args[i+1] for i in range(0,len(args),2)}))" "$@"
}

# ---------------------------------------------------------------- 清理

cleanup() {
  [ "$CLEANED" = "1" ] && return 0

  # ES 一定是先拉回来再清理：否则「清理完索引里还有 e2e 文档」这条断言会假红。
  if [ "$ES_STOPPED" = "1" ]; then
    info "清理前先把 elasticsearch 拉回来"
    ensure_es_up && ES_STOPPED=0
  fi

  local post_cond="" uid_cond="" out ids
  for ids in $(printf '%s' "$P6_POST_IDS" | tr ',' ' '); do
    post_cond="$post_cond OR payload LIKE '%$ids%'"
  done
  for ids in $(printf '%s' "$P6_USER_IDS" | tr ',' ' '); do
    uid_cond="$uid_cond OR payload LIKE '%$ids%'"
  done

  ids=$(sql_exec "SELECT IFNULL(GROUP_CONCAT(id), 0) FROM kuaikan_user.t_user
      WHERE email LIKE 'e2e+p6%@kuaikan.test';" | tr -d '\r\n ')
  [ -z "$ids" ] && ids=0

  # 多表 DELETE 必须在 USE 之后：`DELETE c FROM a c JOIN b ...` 在没选默认库时
  # 直接报 `No database selected`，而 sql_exec 把 stderr 丢掉了 ——
  # 于是"清理成功"是一句假话，测试数据会一直堆在库里。所以这里用 sql_exec_v。
  out=$(sql_exec_v "
    USE kuaikan_content;
    DELETE c FROM t_comment c
      JOIN t_post p ON p.id = c.post_id
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p6%';
    DELETE p FROM t_post p
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name LIKE 'e2e-p6%';
    DELETE FROM t_outbox
      WHERE topic IN ('kuaikan_post_created', 'kuaikan_post_deleted')
        AND (payload LIKE '%e2e-p6%'$post_cond);
    USE kuaikan_community;
    DELETE m FROM t_community_member m
      JOIN t_community c ON c.id = m.community_id
      WHERE c.name LIKE 'e2e-p6%';
    DELETE FROM t_community WHERE name LIKE 'e2e-p6%';
    USE kuaikan_user;
    DELETE FROM t_refresh_token WHERE user_id IN ($ids);
    DELETE FROM t_outbox
      WHERE topic = 'kuaikan_user_profile_updated'
        AND (payload LIKE '%e2e-p6%'$uid_cond);
    DELETE FROM t_user WHERE email LIKE 'e2e+p6%@kuaikan.test';")
  case "$out" in
    *ERROR*) printf '  %s清理失败%s %s\n' "$R" "$N" "$(printf '%s' "$out" | head -3 | tr '\n' ' ')" ;;
    *) [ "$CLEANUP_NEEDED" = "1" ] && info "已清理 P6 测试账号、社群、帖子与 outbox 事件" ;;
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

  # ES 是派生存储：库里的行删掉后，**文档不会自己消失**（事件已经发过了）。
  # 全量重建是最省事也最可信的收敛手段（幂等，且以库为准）。
  if [ "$CLEANUP_NEEDED" = "1" ] && es_reachable; then
    rebuild_index >/dev/null 2>&1 && info "已重建索引，清掉测试文档" \
      || info "重建索引失败（ES 可能刚起来），L4 会再断言一次"
  fi

  CLEANED=1
}
trap cleanup EXIT

# ================================================================ L0 本地契约与配置

if want_layer l0; then
  section "L0 本地契约与配置"

  out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1) \
    && ok "错误码契约三方一致" \
    || ng "错误码契约不一致" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"

  out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1) \
    && ok "OpenAPI 与网关放行规则一致（含搜索端点）" \
    || ng "OpenAPI 与放行规则不一致" "$(printf '%s' "$out" | sed -n '2p')"

  out=$(node "$APP_DIR/deploy/bin/check-scripts.mjs" 2>&1) \
    && ok "shell 脚本静态检查通过（含本脚本）" \
    || ng "shell 脚本静态检查" "$(printf '%s' "$out" | sed -n '2p')"

  # bash -n 只查语法：macOS bash 3.2 与云端 bash 5 的语法差异在这里挡不住，
  # 但语法错误（少 fi / 少 done）会立刻红。
  syntax_bad=""
  for f in "$APP_DIR"/deploy/bin/*.sh; do
    bash -n "$f" 2>/dev/null || syntax_bad="$syntax_bad $(basename "$f")"
  done
  [ -z "$syntax_bad" ] && ok "deploy/bin 下全部脚本 bash -n 通过" || ng "脚本语法错误" "$syntax_bad"

  # P6 的错误码：40010 参数非法、50300 上游不可用（ES 挂了）
  missing_codes=""
  for code in 40010 50300; do
    grep -qE "\"code\": $code([^0-9]|$)" "$APP_DIR/contract/error-codes.json" || missing_codes="$missing_codes $code"
  done
  [ -z "$missing_codes" ] && ok "搜索用到的错误码已登记（40010 / 50300）" \
    || ng "错误码契约缺项" "$missing_codes"

  # elasticsearch 是纯内网组件：一旦映射宿主机端口，ES 控制台（无认证！）
  # 就直接暴露在公网上。这条不变量必须由脚本守住，而不是靠人记得。
  es_block=$(awk '
    /^  elasticsearch:/ {inblock=1; next}
    inblock && /^  [A-Za-z0-9_-]+:/ {inblock=0}
    inblock {print}
  ' "$COMPOSE_FILE")
  if [ -z "$es_block" ]; then
    ng "compose.yml 里找不到 elasticsearch 服务块"
  else
    if printf '%s\n' "$es_block" | grep -qE '^[[:space:]]+ports:'; then
      ng "elasticsearch 映射了宿主机端口（违反纯内网不变量）" "$(printf '%s\n' "$es_block" | grep -A2 'ports:')"
    else
      ok "compose.yml 里 elasticsearch 没有 ports 映射"
    fi
    leaked_port=$(printf '%s\n' "$es_block" | grep -oE '"[0-9.]+:9200:9200"' || true)
    [ -z "$leaked_port" ] && ok "elasticsearch 没有 9200 的宿主机发布" || ng "9200 被发布" "$leaked_port"
    printf '%s\n' "$es_block" | grep -q 'ipv4_address: 172.30.10.15' \
      && ok "elasticsearch 固定内网 IP 172.30.10.15" || ng "elasticsearch 缺少固定内网 IP"
  fi
  if grep -qE '^[[:space:]]+- "[0-9.]+:9200:9200"' "$COMPOSE_FILE"; then
    ng "compose.yml 里某处仍把 9200 发布到宿主机"
  else
    ok "整份 compose 里没有把 9200 发布到宿主机"
  fi

  # P6.4 把搜索放行从「正则通配」收紧到「方法+路径」精确条目。
  # 通配一旦回来，/api/search/internal/** 之类的路径就会被顺带放行。
  gw="$APP_DIR/services/gateway/src/main/resources/application.yml"
  grep -qE '^[[:space:]]+- GET /api/search/posts[[:space:]]*$' "$gw" \
    && ok "网关白名单是精准条目 GET /api/search/posts" \
    || ng "网关白名单缺少精准的 GET /api/search/posts"
  if awk '/public-patterns:/{f=1} f && /api\/search/{print}' "$gw" | grep -q .; then
    ng "public-patterns 里仍有 /api/search 通配放行" "$(awk '/public-patterns:/{f=1} f && /api\/search/{print}' "$gw" | head -2 | tr '\n' ' ')"
  else
    ok "public-patterns 里没有 /api/search 通配（不会顺带放行写方法与 internal 路径）"
  fi
  grep -q 'Path=/api/search/\*\*' "$gw" && grep -q 'StripPrefix=2' "$gw" \
    && ok "网关有 /api/search/** 路由且剥离 2 段前缀" || ng "网关的搜索路由或 StripPrefix 缺失"
  grep -q 'InternalPathBlockFilter' "$APP_DIR/services/gateway/src/main/java/top/katzenyasax/kuaikan/gateway/filter/InternalPathBlockFilter.java" \
    && ok "网关仍有 /internal/** 拦截过滤器" || ng "网关的 /internal 拦截过滤器不见了"

  # 工作区干净只在全量时检查：单独跑 --layer 时工作区本来就可能脏
  if [ -z "$ONLY_LAYER_NORM" ]; then
    dirty=$(cd "$APP_DIR" && git status --porcelain 2>/dev/null)
    [ -z "$dirty" ] && ok "工作区干净（全量验收的前置条件）" \
      || ng "工作区有未提交改动" "$(printf '%s' "$dirty" | head -3 | tr '\n' ' ')"
  else
    skip "工作区干净" "只跑 ${ONLY_LAYER_NORM}"
  fi
fi

# ================================================================ L1 基础设施与全量重建

if want_layer l1; then
  section "L1 基础设施与全量重建"

  CONTAINERS="gateway user-service community-service content-service interaction-service
    notification-service search-service rank-service elasticsearch mysql redis nacos rmq-namesrv rmq-broker"
  out=$(ssh_run 'for c in gateway user-service community-service content-service interaction-service \
      notification-service search-service rank-service elasticsearch mysql redis nacos rmq-namesrv rmq-broker; do
      printf "%s=%s\n" "$c" "$(docker inspect -f "{{.State.Health.Status}}" "kuaikan-$c-1" 2>/dev/null)"
    done')
  unhealthy=""
  for name in $CONTAINERS; do
    st=$(printf '%s\n' "$out" | grep "^${name}=" | head -1 | cut -d= -f2)
    [ "$st" = "healthy" ] || unhealthy="$unhealthy ${name}(${st:-unknown})"
  done
  [ -z "$unhealthy" ] && ok "14 个容器全部 healthy（含 elasticsearch）" || ng "容器不健康" "$unhealthy"

  # ES 集群本身
  health=$(es_get '/_cluster/health' | json_field 'status')
  case "${health:-}" in
    green|yellow) ok "ES 集群健康（${health}）" ;;
    *) ng "ES 集群状态不对" "${health:-无响应}" ;;
  esac

  plugins=$(ssh_run "docker exec $ES_CT bin/elasticsearch-plugin list 2>/dev/null")
  printf '%s\n' "$plugins" | grep -qx 'analysis-ik' \
    && ok "ES 已装 analysis-ik 插件" || ng "ES 缺 analysis-ik 插件" "$(printf '%s' "$plugins" | head -2 | tr '\n' ' ')"

  # 中文分词：标准分词器会把「全文搜索」切成单字（全/文/搜/索），
  # 只有 IK 才会切出「全文」「搜索」。这条断言同时证明插件**生效**而不只是**装了**。
  analyzed=$(es_api POST '/post_read/_analyze' '{"analyzer":"ik_smart","text":"全文搜索"}' | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
print(','.join(t.get('token','') for t in d.get('tokens') or []))" 2>/dev/null)
  [ "$analyzed" = "全文,搜索" ] \
    && ok "ik_smart 对「全文搜索」切出 全文/搜索（中文分词生效）" \
    || ng "IK 中文分词不对" "实得 ${analyzed:-空}"

  # 三个搜索 topic 必须存在：消费者在 topic 创建前订阅拿不到路由（P4.2 踩过）
  topics=$(ssh_run "docker exec kuaikan-rmq-broker-1 sh $MQ_BIN topicList -n $MQ_NAMESRV 2>/dev/null")
  missing_topics=""
  for t in kuaikan_post_created kuaikan_post_deleted kuaikan_user_profile_updated; do
    printf '%s\n' "$topics" | grep -qx "$t" || missing_topics="$missing_topics $t"
  done
  [ -z "$missing_topics" ] && ok "3 个搜索 topic 都已创建" || ng "搜索 topic 缺项" "$missing_topics"

  # 三个消费组互不相同，且 Diff=0（有积压说明消费者没在跑，后面所有同步断言都会失真）
  groups="post-created:kuaikan_post_created post-deleted:kuaikan_post_deleted user-updated:kuaikan_user_profile_updated"
  group_bad=""
  for pair in $groups; do
    g="kuaikan-search-$(printf '%s' "$pair" | cut -d: -f1)-consumer"
    t=$(printf '%s' "$pair" | cut -d: -f2)
    cons=$(ssh_run "docker exec kuaikan-rmq-broker-1 sh $MQ_BIN consumerProgress -n $MQ_NAMESRV -g $g 2>/dev/null")
    rows=$(printf '%s\n' "$cons" | awk -v topic="$t" '$1==topic{c++} END{print c+0}')
    [ "${rows:-0}" -ge 1 ] || group_bad="$group_bad ${g}(未订阅)"
    diff=""
    for _ in $(seq 1 10); do
      diff=$(printf '%s\n' "$cons" | awk -v topic="$t" '$1==topic{s+=$6} END{print s+0}')
      [ "$diff" = "0" ] && break
      sleep 2
      cons=$(ssh_run "docker exec kuaikan-rmq-broker-1 sh $MQ_BIN consumerProgress -n $MQ_NAMESRV -g $g 2>/dev/null")
    done
    [ "$diff" = "0" ] || group_bad="$group_bad ${g}(Diff=$diff)"
  done
  [ -z "$group_bad" ] && ok "3 个搜索消费组都已订阅且无积压" || ng "搜索消费组有问题" "$group_bad"

  # 全量重建：索引文档数必须与库里 status=1 的帖子数一致
  db_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
  rb=$(rebuild_index)
  rb_code=$(printf '%s' "$rb" | json_field 'code')
  rb_index=$(printf '%s' "$rb" | json_field 'data.indexName')
  rb_count=$(printf '%s' "$rb" | json_field 'data.indexedCount')
  if [ "$rb_code" = "0" ] && [ -n "$rb_index" ]; then
    ok "POST /internal/admin/rebuild 成功（${rb_index}，${rb_count} 条）"
  else
    ng "全量重建失败" "code=${rb_code:-空} $(printf '%s' "$rb" | head -c 120)"
  fi
  [ -n "$db_count" ] && [ "$rb_count" = "$db_count" ] \
    && ok "重建写入文档数等于 MySQL 有效帖数（${db_count}）" \
    || ng "索引文档数与库不一致" "重建=${rb_count:-空} 库=${db_count:-空}"

  # 别名：post_read / post_write 必须同时指向**同一个**刚建好的物理索引
  alias_json=$(es_get '/_cat/aliases?format=json')
  alias_read=$(printf '%s' "$alias_json" | python3 -c "
import json,sys
try: rows=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
print(','.join(r['index'] for r in rows if r.get('alias')=='post_read'))" 2>/dev/null)
  alias_write=$(printf '%s' "$alias_json" | python3 -c "
import json,sys
try: rows=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
print(','.join(r['index'] for r in rows if r.get('alias')=='post_write'))" 2>/dev/null)
  if [ -n "$alias_read" ] && [ "$alias_read" = "$alias_write" ]; then
    ok "post_read / post_write 指向同一个物理索引（${alias_read}）"
  else
    ng "读写别名没有指向同一索引" "read=${alias_read:-空} write=${alias_write:-空}"
  fi
  case "${alias_read:-}" in
    post_v[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9])
      ok "物理索引名符合 post_v{yyyyMMddHHmmss}" ;;
    *) ng "物理索引名不符合约定" "${alias_read:-空}" ;;
  esac
  [ -n "$rb_index" ] && [ "$alias_read" = "$rb_index" ] \
    && ok "重建后别名已指向新建索引（零停机切换生效）" \
    || ng "别名没有指向刚重建的索引" "别名=${alias_read:-空} 重建=${rb_index:-空}"

  es_total=$(es_count)
  [ -n "$es_total" ] && [ "$es_total" = "$db_count" ] \
    && ok "ES 索引文档数与 MySQL 有效帖数一致（${es_total}）" \
    || ng "ES 文档数与库不一致" "ES=${es_total:-空} 库=${db_count:-空}"

  # 重建不能把搜索搞挂：拿库里最新一条帖的标题当关键词再打一次对外接口
  probe_title=$(sql_exec "SELECT title FROM kuaikan_content.t_post WHERE status=1 ORDER BY created_at DESC LIMIT 1;" | tr -d '\r\n')
  probe=$(python3 -c "
import sys
t=sys.argv[1].strip()
print(t[:min(12,len(t))])" "$probe_title" 2>/dev/null)
  if [ -z "$probe" ]; then
    skip "重建后对外检索可用" "库里没有 status=1 的帖子，拿不到探针关键词"
  else
    body=$(api_get "$(search_url "q=$(enc "$probe")&limit=5")")
    hits=$(printf '%s' "$body" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['data'].get('items') or []))
except Exception: print(-1)" 2>/dev/null)
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] && [ "${hits:-0}" -ge 1 ] 2>/dev/null \
      && ok "重建后对外检索仍可用（q=「${probe}」命中 ${hits} 条）" \
      || ng "重建后对外检索不可用" "code=$(printf '%s' "$body" | json_field 'code') hits=${hits:-空}"
  fi
fi

# ================================================================ L2 增删改同步与双面检索

L2_READY=0
L2_STEP=""

prepare_l2() {
  [ "$L2_READY" = "1" ] && return 0
  L2_STEP="SSH"
  ssh_run 'true' || return 1

  L2_EMAIL="e2e+p6l2${STAMP}@kuaikan.test"
  L2_NICK="e2e-p6-l2-${STAMP}"
  L2_NICK_NEW="e2e-p6-renamed-${STAMP}"
  L2_C1_NAME="e2e-p6-l2-c1-${STAMP}"
  L2_C2_NAME="e2e-p6-l2-c2-${STAMP}"
  L2_TOKEN="p6e2e${STAMP}"

  L2_STEP="建测试账号"
  L2_UID=$(mk_user "$L2_EMAIL" "$L2_NICK")
  [ -n "$L2_UID" ] || return 1
  CLEANUP_NEEDED=1
  P6_USER_IDS=$(remember_ids "$P6_USER_IDS" "$L2_UID")

  L2_STEP="账号登录"
  L2_T=$(login_token "$L2_EMAIL" "$FIXTURE_PASS")
  [ -n "$L2_T" ] || return 1

  L2_STEP="建两个社群"
  L2_C1=$(create_community "$L2_T" "$L2_C1_NAME")
  L2_C2=$(create_community "$L2_T" "$L2_C2_NAME")
  [ -n "$L2_C1" ] && [ -n "$L2_C2" ] || return 1

  L2_STEP="发帖"
  L2_P1_TITLE="e2e-p6 ${L2_TOKEN} 第一帖"
  L2_P2_TITLE="e2e-p6 ${L2_TOKEN} 第二帖"
  L2_P3_TITLE="e2e-p6 ${L2_TOKEN} 第三帖"
  L2_P4_TITLE="e2e-p6 ${L2_TOKEN} 第四帖"
  L2_P1_BODY="e2e P6 第一帖正文：全文搜索走 Elasticsearch"
  L2_P2_BODY="e2e P6 第二帖正文：中文分词用 IK"
  L2_P1=$(create_post "$L2_T" "$L2_C1" "$L2_P1_TITLE" "$L2_P1_BODY")
  L2_P2=$(create_post "$L2_T" "$L2_C1" "$L2_P2_TITLE" "$L2_P2_BODY")
  L2_P3=$(create_post "$L2_T" "$L2_C1" "$L2_P3_TITLE" "e2e P6 第三帖正文")
  L2_P4=$(create_post "$L2_T" "$L2_C2" "$L2_P4_TITLE" "e2e P6 第四帖正文")
  [ -n "$L2_P1" ] && [ -n "$L2_P2" ] && [ -n "$L2_P3" ] && [ -n "$L2_P4" ] || return 1
  P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L2_P1")
  P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L2_P2")
  P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L2_P3")
  P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L2_P4")

  info "L2 夹具：用户=$L2_UID 社群=${L2_C1}/${L2_C2} 帖=${L2_P1}..${L2_P4} 关键词=${L2_TOKEN}"
  L2_STEP=""
  L2_READY=1
  return 0
}

if want_layer l2; then
  section "L2 增删改同步与双面检索"

  if ! prepare_l2; then
    ng "创建 L2 夹具失败" "失败在：${L2_STEP:-未知}"
  else
    q_token="q=$(enc "$L2_TOKEN")"

    # ---------------- 发帖 → 秒级进 ES
    # outbox → MQ → 消费者 → ES 是异步的：轮询而不是固定 sleep
    hit=""
    waited=0
    for _ in $(seq 1 20); do
      hit=$(item_field "${q_token}&limit=10" "$L2_P1" 'postId')
      [ -n "$hit" ] && break
      sleep 1
      waited=$((waited+1))
    done
    if [ -n "$hit" ]; then
      ok "发帖后几秒内就能被搜到（${waited}s 内，事件 → ES 同步通）" "$L2_P1"
    else
      ng "发帖 20s 内没有进索引（事件链路或消费者有问题）" "$L2_P1"
    fi

    got_title=$(item_field "${q_token}&limit=10" "$L2_P1" 'title')
    got_community=$(item_field "${q_token}&limit=10" "$L2_P1" 'communityName')
    got_author=$(item_field "${q_token}&limit=10" "$L2_P1" 'authorNickname')
    [ "$got_title" = "$L2_P1_TITLE" ] && ok "搜索结果标题正确" || ng "搜索结果标题不对" "实得 ${got_title:-空}"
    [ "$got_community" = "$L2_C1_NAME" ] && ok "搜索结果带社群名（反范式字段补齐）" \
      || ng "搜索结果缺社群名" "实得 ${got_community:-空}"
    [ "$got_author" = "$L2_NICK" ] && ok "搜索结果带作者昵称（反范式字段补齐）" \
      || ng "搜索结果缺作者昵称" "实得 ${got_author:-空}"

    # 高亮：后端只下发 \uE000/\uE001 包裹的纯文本，绝不输出 HTML。
    # 占位符用 python 判断：bash 3.2 不认 $'\uE000'（那是 4.2 才有的转义）。
    hl_title=$(item_field "${q_token}&limit=10" "$L2_P1" 'titleHighlight')
    hl_snippet=$(item_field "${q_token}&limit=10" "$L2_P1" 'bodySnippet')
    has_open=$(printf '%s' "$hl_title" | python3 -c "
import sys
t=sys.stdin.read()
print('yes' if '\uE000' in t and '\uE001' in t else 'no')" 2>/dev/null)
    if [ "$has_open" = "yes" ]; then
      ok "标题高亮带 \\uE000/\\uE001 占位符（前端据此切 <mark>）" "$(printf '%s' "$hl_title" | python3 -c "
import sys
print(sys.stdin.read().replace('\uE000','').replace('\uE001','')[:40])" 2>/dev/null)"
    else
      ng "标题高亮没有占位符" "实得 ${hl_title:-空}"
    fi
    case "${hl_title}${hl_snippet}" in
      *'<'*|*'&lt;'*) ng "高亮字段里出现了 HTML（XSS 面）" "$(printf '%s' "$hl_title$hl_snippet" | head -c 80)" ;;
      *) ok "高亮字段是纯文本（不含任何 HTML 标签）" ;;
    esac

    # ---------------- 改昵称 → 历史帖 authorNickname 同步
    body=$(patch_nickname "$L2_T" "$L2_NICK_NEW")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "修改昵称成功" || ng "修改昵称失败" "$(printf '%s' "$body" | head -c 120)"

    es_nick=""
    waited=0
    for _ in $(seq 1 20); do
      es_nick=$(es_doc_field "$L2_P1" 'authorNickname')
      [ "$es_nick" = "$L2_NICK_NEW" ] && break
      sleep 1
      waited=$((waited+1))
    done
    [ "$es_nick" = "$L2_NICK_NEW" ] \
      && ok "ES 历史帖的 authorNickname 已同步（update_by_query，${waited}s）" \
      || ng "ES 里的作者昵称没更新" "实得 ${es_nick:-空} 期望 $L2_NICK_NEW"

    q_nick="q=$(enc "$L2_NICK_NEW")"
    found_by_nick=""
    waited=0
    for _ in $(seq 1 20); do
      found_by_nick=$(item_field "${q_nick}&limit=10" "$L2_P1" 'authorNickname')
      [ "$found_by_nick" = "$L2_NICK_NEW" ] && break
      sleep 1
      waited=$((waited+1))
    done
    [ "$found_by_nick" = "$L2_NICK_NEW" ] \
      && ok "用新昵称能搜到历史帖（作者昵称参与检索）" \
      || ng "用新昵称搜不到历史帖" "实得 ${found_by_nick:-空}"

    # ---------------- 排序：latest 严格按时间倒序；relevance 结果集相同
    order_ids=$(search_ids "${q_token}&sort=latest&limit=10")
    order_ok=$(api_get "$(search_url "${q_token}&sort=latest&limit=10")" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
ts=[i.get('createdAt') for i in items]
print('ok' if ts == sorted(ts, reverse=True) else 'bad')" 2>/dev/null)
    [ "$order_ok" = "ok" ] && ok "sort=latest 的结果严格按发布时间倒序" \
      || ng "sort=latest 顺序不对" "$(printf '%s' "$order_ids" | head -c 80)"
    first_latest=$(printf '%s' "$order_ids" | cut -d, -f1)
    [ "$first_latest" = "$L2_P4" ] \
      && ok "最新排序的第一条是最后发的那条帖" || ng "最新排序的第一条不对" "实得 ${first_latest:-空}"

    rel_ids=$(search_ids "${q_token}&sort=relevance&limit=10")
    expected=$(printf '%s\n' "$L2_P1" "$L2_P2" "$L2_P3" "$L2_P4" | sort | tr '\n' ',')
    got_sorted=$(printf '%s\n' "$rel_ids" | tr ',' '\n' | sort | tr '\n' ',')
    [ "$got_sorted" = "$expected" ] \
      && ok "sort=relevance 命中同一批帖子（4 条，顺序可变）" \
      || ng "relevance 的结果集不对" "实得 ${rel_ids:-空}"

    # ---------------- 社群筛选
    c1_ids=$(search_ids "${q_token}&communityId=${L2_C1}&limit=10")
    c1_count=$(printf '%s' "$c1_ids" | tr ',' '\n' | grep -c .)
    if [ "${c1_count:-0}" = "3" ] && printf '%s' "$c1_ids" | grep -q "$L2_P3" \
      && ! printf '%s' "$c1_ids" | grep -q "$L2_P4"; then
      ok "按社群筛选只返回该社群的 3 条帖（不含另一社群的帖）"
    else
      ng "社群筛选结果不对" "ids=${c1_ids:-空}"
    fi
    c2_ids=$(search_ids "${q_token}&communityId=${L2_C2}&limit=10")
    [ "$c2_ids" = "$L2_P4" ] && ok "另一个社群筛选只命中它自己的帖" || ng "第二个社群筛选不对" "${c2_ids:-空}"

    # ---------------- 删帖 → 对外搜不到 + 文档消失
    body=$(delete_post "$L2_T" "$L2_P1")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "删帖成功（与 PostDeleted 事件同事务）" || ng "删帖失败" "$(printf '%s' "$body" | head -c 120)"

    gone="no"
    waited=0
    for _ in $(seq 1 20); do
      gone=$(es_doc_found "$L2_P1")
      [ "$gone" = "no" ] && break
      sleep 1
      waited=$((waited+1))
    done
    [ "$gone" = "no" ] && ok "ES 里那条帖子的文档已删除（${waited}s）" \
      || ng "ES 里残留已删帖的文档" "$L2_P1"

    still_hit=""
    waited=0
    for _ in $(seq 1 20); do
      still_hit=$(item_field "${q_token}&limit=10" "$L2_P1" 'postId')
      [ -z "$still_hit" ] && break
      sleep 1
      waited=$((waited+1))
    done
    left_ids=$(search_ids "${q_token}&limit=10")
    [ -z "$still_hit" ] && ok "删帖后对外搜索再也搜不到（${waited}s）" \
      || ng "删掉的帖子还能被搜到" "$L2_P1"
    left_count=$(printf '%s' "$left_ids" | tr ',' '\n' | grep -c .)
    [ "${left_count:-0}" = "3" ] && ok "其余 3 条帖仍在索引里（删帖不是把索引清空）" \
      || ng "删帖后索引剩下的条数不对" "实得 ${left_ids:-空}"

    # ---------------- 游标翻页：不重不漏
    page1=$(search_ids "${q_token}&sort=latest&limit=2")
    cursor=$(next_cursor "${q_token}&sort=latest&limit=2")
    if [ -z "$cursor" ]; then
      ng "第一页没有返回 nextCursor，翻页无法验证" "ids=${page1:-空}"
    else
      page2=$(search_ids "${q_token}&sort=latest&limit=2&cursor=$(enc "$cursor")")
      p1_count=$(printf '%s' "$page1" | tr ',' '\n' | grep -c .)
      p2_count=$(printf '%s' "$page2" | tr ',' '\n' | grep -c .)
      overlap=$(printf '%s\n' "$page1" | tr ',' '\n' | grep -c -F -x -f <(printf '%s\n' "$page2" | tr ',' '\n') 2>/dev/null)
      union_all=$(printf '%s\n%s\n' "$page1" "$page2" | tr ',' '\n' | grep . | sort -u | tr '\n' ',')
      expected_union=$(printf '%s\n' "$L2_P2" "$L2_P3" "$L2_P4" | sort | tr '\n' ',')
      if [ "${p1_count:-0}" = "2" ] && [ "${p2_count:-0}" = "1" ] && [ "${overlap:-1}" = "0" ] \
        && [ "$union_all" = "$expected_union" ]; then
        ok "游标翻页 2+1 条，两页无重叠且并集完整（不重不漏）"
      else
        ng "游标翻页有问题" "page1=${page1:-空} page2=${page2:-空} overlap=${overlap:-空}"
      fi

      # 跨排序复用游标必须是 40010，而不是拿 latest 的 search_after 去翻 relevance
      bad=$(api_get "$(search_url "${q_token}&sort=relevance&limit=2&cursor=$(enc "$cursor")")")
      [ "$(printf '%s' "$bad" | json_field 'code')" = "40010" ] \
        && ok "把 latest 的游标喂给 relevance → 40010" || ng "跨排序游标被接受了"
    fi

    # ---------------- 参数边界（40010）
    for spec in "空 q|q=" "缺少 q|" "全空白 q|q=%20%20" "未知 sort|q=$(enc "$L2_TOKEN")&sort=bogus"; do
      label=${spec%%|*}
      qs=${spec#*|}
      body=$(api_get "$(search_url "$qs")")
      [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
        && ok "${label} → 40010" || ng "${label} 没有被拒绝" "code=$(printf '%s' "$body" | json_field 'code')"
    done

    # ---------------- 对内检索：过滤条件与 includeBody
    is_author=$(internal_search "{\"authorId\":\"$L2_UID\",\"limit\":100}")
    is_author_ok=$(printf '%s' "$is_author" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
if not items: print('empty'); raise SystemExit(0)
print('ok' if all(str(i.get('authorId'))=='$L2_UID' for i in items) and len(items)>=3 else 'bad')" 2>/dev/null)
    [ "$is_author_ok" = "ok" ] && ok "对内按 authorId 过滤：全部命中该作者且条数正确" \
      || ng "对内按 authorId 过滤不对" "$(printf '%s' "$is_author" | head -c 120)"

    is_nick=$(internal_search "{\"authorNickname\":\"$L2_NICK_NEW\",\"limit\":100}")
    is_nick_ok=$(printf '%s' "$is_nick" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
if not items: print('empty'); raise SystemExit(0)
print('ok' if all(i.get('authorNickname')=='$L2_NICK_NEW' for i in items) else 'bad')" 2>/dev/null)
    [ "$is_nick_ok" = "ok" ] && ok "对内按 authorNickname 过滤：昵称精确命中" \
      || ng "对内按 authorNickname 过滤不对" "$(printf '%s' "$is_nick" | head -c 120)"

    is_comm=$(internal_search "{\"communityName\":\"$L2_C1_NAME\",\"limit\":100}")
    is_comm_ok=$(printf '%s' "$is_comm" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
ids=[str(i.get('postId')) for i in items]
if not items: print('empty'); raise SystemExit(0)
print('ok' if all(i.get('communityName')=='$L2_C1_NAME' for i in items) and '$L2_P4' not in ids else 'bad')" 2>/dev/null)
    [ "$is_comm_ok" = "ok" ] && ok "对内按 communityName 过滤：只返回该社群且不含另一社群" \
      || ng "对内按 communityName 过滤不对" "$(printf '%s' "$is_comm" | head -c 120)"

    is_kw=$(internal_search "{\"keyword\":\"$L2_TOKEN\",\"limit\":100}")
    is_kw_body=$(printf '%s' "$is_kw" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
target=[i for i in items if str(i.get('postId'))=='$L2_P2']
if not target: print('missing'); raise SystemExit(0)
print('null' if target[0].get('body') is None else 'body')" 2>/dev/null)
    [ "$is_kw_body" = "null" ] && ok "对内 keyword 命中，且 includeBody 默认 false（body 为 null）" \
      || ng "对内 keyword 检索或默认正文策略不对" "实得 ${is_kw_body:-空}"

    is_kw_full=$(internal_search "{\"keyword\":\"$L2_TOKEN\",\"limit\":100,\"includeBody\":true}")
    is_kw_full_ok=$(printf '%s' "$is_kw_full" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'].get('items') or []
except Exception: print('bad'); raise SystemExit(0)
target=[i for i in items if str(i.get('postId'))=='$L2_P2']
if not target: print('missing'); raise SystemExit(0)
print('ok' if (target[0].get('body') or '').strip()=='$L2_P2_BODY' else 'bad:'+str(target[0].get('body'))[:40])" 2>/dev/null)
    [ "$is_kw_full_ok" = "ok" ] && ok "includeBody=true 返回完整正文（AI 阅读用）" \
      || ng "includeBody=true 没有返回完整正文" "实得 ${is_kw_full_ok:-空}"

    now_ms=$(python3 -c 'import time;print(int(time.time()*1000))')
    from_ms=$((now_ms - 3600 * 1000))
    to_ms=$((now_ms + 3600 * 1000))
    future_ms=$((now_ms + 86400 * 1000))
    in_range=$(internal_search "{\"keyword\":\"$L2_TOKEN\",\"createdFrom\":\"$from_ms\",\"createdTo\":\"$to_ms\",\"limit\":100}")
    in_range_n=$(printf '%s' "$in_range" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['data'].get('items') or []))
except Exception: print(-1)" 2>/dev/null)
    [ "${in_range_n:-0}" -ge 3 ] 2>/dev/null && ok "对内时间范围过滤命中窗口内的帖（${in_range_n} 条）" \
      || ng "对内时间范围过滤少返回" "实得 ${in_range_n:-空}"

    out_range=$(internal_search "{\"keyword\":\"$L2_TOKEN\",\"createdFrom\":\"$future_ms\",\"limit\":100}")
    out_range_n=$(printf '%s' "$out_range" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['data'].get('items') or []))
except Exception: print(-1)" 2>/dev/null)
    [ "${out_range_n:-1}" = "0" ] && ok "时间范围落在未来 → 0 条（过滤真的生效）" \
      || ng "未来时间范围仍有结果" "实得 ${out_range_n:-空}"

    reversed_range=$(internal_search "{\"createdFrom\":\"$to_ms\",\"createdTo\":\"$from_ms\"}")
    [ "$(printf '%s' "$reversed_range" | json_field 'code')" = "40010" ] \
      && ok "createdFrom 晚于 createdTo → 40010" || ng "时间范围倒置没有被拒绝"

    # ---------------- 公网拿不到内部检索
    # 真正的保护在网关上：InternalPathBlockFilter 把 /api/{svc}/internal/** 直接 404。
    gw_bad=""
    c=$(http_code "$SITE/api/search/internal/search/posts")
    [ "$c" = "404" ] || gw_bad="$gw_bad GET($c)"
    c=$(http_code_post "$SITE/api/search/internal/search/posts" '{"keyword":"x"}')
    [ "$c" = "404" ] || gw_bad="$gw_bad POST($c)"
    [ -z "$gw_bad" ] && ok "公网 /api/search/internal/search/posts 被网关拦成 404（GET 与 POST）" \
      || ng "内部检索端点经由网关可达" "$gw_bad"

    # 站点根的 /internal/**：nginx 没有这条路由，GET 只是 SPA 回退（200 text/html）
    r_get=$(internal_probe GET)
    r_post=$(internal_probe POST)
    if probe_ok "$r_get" && probe_ok "$r_post"; then
      ok "站点根 /internal/search/posts 拿不到接口（GET=SPA 回退 HTML，POST=405）" \
        "GET=${r_get} POST=${r_post}"
    else
      ng "站点根的 /internal/search/posts 拿到了接口响应" "GET=${r_get} POST=${r_post}"
    fi

    # 内网可达是上面两条的前提：证明"不可达"不是因为服务根本没这个端点
    inner=$(internal_search '{"limit":1}')
    [ "$(printf '%s' "$inner" | json_field 'code')" = "0" ] \
      && ok "同一端点在容器网络内可用（证明上面的 404 是拦截而不是端点不存在）" \
      || ng "内网调用 /internal/search/posts 也不可用" "$(printf '%s' "$inner" | head -c 120)"
  fi
fi

# ================================================================ L3 浏览器

L3_READY=0
L3_STEP=""

prepare_l3() {
  [ "$L3_READY" = "1" ] && return 0
  L3_STEP="SSH"
  ssh_run 'true' || return 1

  L3_EMAIL="e2e+p6l3${STAMP}@kuaikan.test"
  L3_NICK="e2e-p6-l3-${STAMP}"
  L3_COMMUNITY="e2e-p6-l3-${STAMP}"
  L3_TOKEN="p6l3e2e${STAMP}"

  L3_STEP="建测试账号"
  L3_UID=$(mk_user "$L3_EMAIL" "$L3_NICK")
  [ -n "$L3_UID" ] || return 1
  CLEANUP_NEEDED=1
  P6_USER_IDS=$(remember_ids "$P6_USER_IDS" "$L3_UID")

  L3_STEP="账号登录"
  L3_T=$(login_token "$L3_EMAIL" "$FIXTURE_PASS")
  [ -n "$L3_T" ] || return 1

  L3_STEP="建社群"
  L3_COMMUNITY_ID=$(create_community "$L3_T" "$L3_COMMUNITY")
  [ -n "$L3_COMMUNITY_ID" ] || return 1

  L3_STEP="发帖"
  L3_POST_TITLE="e2e P6 验收帖 ${L3_TOKEN}"
  L3_XSS_TITLE="e2e P6 XSS 帖 ${L3_TOKEN}"
  L3_POST_ID=$(create_post "$L3_T" "$L3_COMMUNITY_ID" "$L3_POST_TITLE" "e2e P6 正文：高亮与筛选都在这里验")
  # 正文里塞一段"看起来像标签"的东西：后端只输出纯文本，前端只渲染文本节点，
  # 所以它必须原样显示、绝不执行。
  L3_XSS_ID=$(create_post "$L3_T" "$L3_COMMUNITY_ID" "$L3_XSS_TITLE" "$XSS_MARK e2e P6 XSS 正文")
  [ -n "$L3_POST_ID" ] && [ -n "$L3_XSS_ID" ] || return 1
  P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L3_POST_ID")
  P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L3_XSS_ID")

  L3_STEP="等索引就绪"
  waited=0
  for _ in $(seq 1 20); do
    if [ -n "$(item_field "q=$(enc "$L3_TOKEN")&limit=10" "$L3_XSS_ID" 'postId')" ]; then
      break
    fi
    sleep 1
    waited=$((waited+1))
  done

  info "L3 夹具：用户=$L3_UID 社群=${L3_COMMUNITY_ID} 帖=${L3_POST_ID}/${L3_XSS_ID} 关键词=${L3_TOKEN}"
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
      # 直接 node 跑：本阶段不改 web/package.json，所以没有 npm script 入口
      if out=$(cd "$WEB_DIR" && SITE="$SITE" E2E_SITE_IP="$SITE_RESOLVE" \
            E2E_TOKEN="$L3_TOKEN" E2E_COMMUNITY="$L3_COMMUNITY" \
            E2E_COMMUNITY_ID="$L3_COMMUNITY_ID" E2E_POST_ID="$L3_POST_ID" \
            E2E_POST_TITLE="$L3_POST_TITLE" E2E_XSS_MARK="$XSS_MARK" \
            node scripts/e2e-p6.mjs 2>&1); then
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

  L4_EMAIL="e2e+p6l4${STAMP}@kuaikan.test"
  L4_NICK="e2e-p6-l4-${STAMP}"
  L4_COMMUNITY="e2e-p6-l4-${STAMP}"
  L4_TOKEN="p6l4e2e${STAMP}"

  L4_STEP="建测试账号"
  L4_UID=$(mk_user "$L4_EMAIL" "$L4_NICK")
  [ -n "$L4_UID" ] || return 1
  CLEANUP_NEEDED=1
  P6_USER_IDS=$(remember_ids "$P6_USER_IDS" "$L4_UID")

  L4_STEP="账号登录"
  L4_T=$(login_token "$L4_EMAIL" "$FIXTURE_PASS")
  [ -n "$L4_T" ] || return 1

  L4_STEP="建社群"
  L4_COMMUNITY_ID=$(create_community "$L4_T" "$L4_COMMUNITY")
  [ -n "$L4_COMMUNITY_ID" ] || return 1

  info "L4 夹具：用户=$L4_UID 社群=${L4_COMMUNITY_ID} 关键词=${L4_TOKEN}"
  L4_STEP=""
  L4_READY=1
  return 0
}

if want_layer l4; then
  section "L4 破坏性故障隔离（停 ES → 恢复 ES）"

  if ! prepare_l4; then
    ng "创建 L4 夹具失败" "失败在：${L4_STEP:-未知}"
  else
    q4="q=$(enc "$L4_TOKEN")"

    # 0. 先证明「产生路径确实通」：没有这条，后面的 503 断言可能只是因为搜索本来就没数据
    L4_P1=$(create_post "$L4_T" "$L4_COMMUNITY_ID" "e2e-p6 ${L4_TOKEN} 崩溃前" "e2e P6 停 ES 之前的正文")
    P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L4_P1")
    hit=""
    for _ in $(seq 1 20); do
      hit=$(item_field "${q4}&limit=10" "$L4_P1" 'postId')
      [ -n "$hit" ] && break
      sleep 1
    done
    [ -n "$hit" ] && ok "停 ES 前：新帖能搜到（搜索本来是好的）" \
      || ng "停 ES 前就搜不到，后面的 503 断言会变得没有意义"

    # 1. 停 ES
    ssh_run "docker stop $ES_CT >/dev/null 2>&1"
    case "$(svc_state "$ES_CT")" in
      exited*) ES_STOPPED=1 ;;
      *) ES_STOPPED=0 ;;
    esac
    if [ "$ES_STOPPED" = "1" ]; then
      ok "elasticsearch 已停止（故障注入成功）"
    else
      ng "停不掉 elasticsearch，故障隔离无法验证" "$(svc_state "$ES_CT")"
    fi

    if [ "$ES_STOPPED" = "1" ]; then
      # 2. search-service 必须保持 running/healthy：ES 是派生存储，不是它的存活前提
      svc_ok=0
      waited=0
      for _ in $(seq 1 12); do
        st=$(svc_state "$SEARCH_CT")
        case "$st" in "running healthy") svc_ok=1; break ;; esac
        sleep 5
        waited=$((waited+5))
      done
      [ "$svc_ok" = "1" ] && ok "ES 停掉后 search-service 仍是 running/healthy（${waited}s 内确认）" \
        || ng "ES 停掉后 search-service 状态异常" "$(svc_state "$SEARCH_CT")"

      # 3. 对外检索：受控降级 503 + 50300，而不是 500 / 挂死
      code=000
      body_code=""
      waited=0
      for _ in $(seq 1 15); do
        code=$(http_code "$(search_url "q=$(enc "$L4_TOKEN")&limit=5")" 30)
        body=$(api_get "$(search_url "q=$(enc "$L4_TOKEN")&limit=5")")
        body_code=$(printf '%s' "$body" | json_field 'code')
        [ "$code" = "503" ] && [ "$body_code" = "50300" ] && break
        sleep 2
        waited=$((waited+2))
      done
      if [ "$code" = "503" ] && [ "$body_code" = "50300" ]; then
        ok "ES 停机时对外检索返回 HTTP 503 + 50300（受控降级，${waited}s 内）"
      else
        ng "ES 停机时的降级不符合契约" "HTTP ${code:-000} code=${body_code:-空}"
      fi

      # 4. 主站完全不受影响：发帖、首页、帖子上限流之外的所有读路径都正常
      L4_P2=$(create_post "$L4_T" "$L4_COMMUNITY_ID" "e2e-p6 ${L4_TOKEN} 崩溃期间" "e2e P6 ES 挂着时发的帖")
      P6_POST_IDS=$(remember_ids "$P6_POST_IDS" "$L4_P2")
      [ -n "$L4_P2" ] && ok "ES 停机时仍然可以发帖（content-service 不受影响）" \
        || ng "ES 停机时发帖失败（ES 不该在写入路径上）"

      hc=$(http_code "$SITE/")
      [ "$hc" = "200" ] && ok "ES 停机时首页仍可访问（HTTP 200）" || ng "ES 停机时首页挂了" "HTTP $hc"

      latest=$(api_get "$SITE/api/content/posts/latest?limit=50")
      has_new=$(printf '%s' "$latest" | python3 -c "
import json,sys
try: items=json.load(sys.stdin)['data'] or []
except Exception: print('bad'); raise SystemExit(0)
print('yes' if any(str(p.get('id'))=='$L4_P2' for p in items) else 'no')" 2>/dev/null)
      [ "$has_new" = "yes" ] && ok "ES 停机时首页最新帖里能看到崩溃期间发的帖" \
        || ng "ES 停机时首页最新帖看不到新帖" "实得 ${has_new:-空}"

      hc=$(http_code "$SITE/c/$(enc "$L4_COMMUNITY")/p/$L4_P1")
      [ "$hc" = "200" ] && ok "ES 停机时帖子详情页仍可打开（HTTP 200）" || ng "帖子详情页打不开" "HTTP $hc"

      # 5. 起 ES 并等它 healthy
      ssh_run "docker start $ES_CT >/dev/null 2>&1"
      ES_STOPPED=0
      if wait_es_healthy 240; then
        ok "elasticsearch 已恢复 healthy（搜索侧故障自愈的前提）"
      else
        ng "elasticsearch 起来了但没到 healthy" "$(svc_state "$ES_CT")"
      fi

      # 6. 搜索立即恢复：不需要重启 search-service
      code=000
      waited=0
      for _ in $(seq 1 20); do
        code=$(http_code "$(search_url "q=$(enc "$L4_TOKEN")&limit=5")" 30)
        [ "$code" = "200" ] && break
        sleep 2
        waited=$((waited+2))
      done
      [ "$code" = "200" ] && ok "ES 恢复后搜索立即恢复 200（无需重启 search-service，${waited}s 内）" \
        || ng "ES 恢复后搜索没有恢复" "HTTP ${code:-000}"

      # 7. 重建收敛：停机期间的事件可能已经重投失败，以库为准重新对齐
      rb=$(rebuild_index)
      [ "$(printf '%s' "$rb" | json_field 'code')" = "0" ] \
        && ok "ES 恢复后全量重建成功（收敛停机期间的写窗口）" \
        || ng "ES 恢复后重建失败" "$(printf '%s' "$rb" | head -c 120)"
      db_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
      es_total=$(es_count)
      [ -n "$es_total" ] && [ "$es_total" = "$db_count" ] \
        && ok "重建后索引文档数与 MySQL 有效帖数一致（${es_total}）" \
        || ng "重建后索引与库不一致" "ES=${es_total:-空} 库=${db_count:-空}"

      both=$(search_ids "${q4}&limit=10")
      if printf '%s' "$both" | grep -q "$L4_P1" && printf '%s' "$both" | grep -q "$L4_P2"; then
        ok "停机前与停机期间发的两条帖重建后都能搜到"
      else
        ng "重建后缺少停机期间的帖" "ids=${both:-空}"
      fi
    fi

    # 8. 清理并核验：不留测试帖在库里，也不留在 ES 里
    CLEANUP_NEEDED=1
    cleanup
    sleep 1

    ids="$P6_USER_IDS"
    [ -z "$ids" ] && ids=0

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_user.t_user WHERE email LIKE 'e2e+p6%@kuaikan.test';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试账号已全部删除" || ng "残留测试账号" "${n:-空} 行"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post p
        JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-p6%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试帖子已清理" || ng "残留测试帖" "${n:-空}"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_community.t_community WHERE name LIKE 'e2e-p6%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "测试社群已清理" || ng "残留测试社群" "${n:-空}"

    n=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_outbox
        WHERE topic IN ('kuaikan_post_created','kuaikan_post_deleted') AND payload LIKE '%e2e-p6%';" | tr -d '\r\n ')
    [ "${n:-1}" = "0" ] && ok "outbox 里的测试事件已清理" || ng "残留 outbox 事件" "${n:-空}"

    left=$(redis_exec "for uid in $(printf '%s' "$ids" | tr ',' ' '); do
        redis-cli --no-auth-warning -a \"\$REDIS_PASSWORD\" ZCARD \"auth:user:\$uid:access\"
      done" | tr -d '\r' | awk '{s+=$1} END{print s+0}')
    [ "$ids" = "0" ] && left=0
    [ "${left:-1}" = "0" ] && ok "Redis 里的测试会话已清空" || ng "残留 Redis 会话" "${left:-空}"

    # ES 是派生存储：库删干净了，文档要靠重建收敛。这里断言"真的收敛了"。
    # 多轮重建见 settle_index 的注释（停机期间的迟到重投会把文档写回来）。
    if settle_index "$L4_TOKEN"; then
      ok "清理后索引里没有任何 e2e 文档（多轮重建收敛，无迟到重投的孤儿帖）"
    else
      ng "清理后索引里仍有 e2e 文档" "$(search_ids "q=$(enc "$L4_TOKEN")&limit=10")"
    fi

    db_count=$(sql_exec "SELECT COUNT(*) FROM kuaikan_content.t_post WHERE status=1;" | tr -d '\r\n ')
    es_total=$(es_count)
    [ -n "$es_total" ] && [ "$es_total" = "$db_count" ] \
      && ok "清理后索引文档数与库一致（无 e2e 文档残留，${es_total}）" \
      || ng "清理后索引里仍有残留文档" "ES=${es_total:-空} 库=${db_count:-空}"

    l4_ids=$(search_ids "q=$(enc "$L4_TOKEN")&limit=10")
    [ -z "$l4_ids" ] && ok "清理后搜不到任何 e2e 测试帖（首页也不会出现）" \
      || ng "清理后仍能搜到 e2e 测试帖" "${l4_ids:-空}"

    latest=$(api_get "$SITE/api/content/posts/latest?limit=50")
    residue=$(printf '%s' "$latest" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['data'] or []
except Exception: print('bad'); raise SystemExit(0)
bad=[p.get('title') for p in d if str(p.get('title') or '').startswith('e2e')]
print(';'.join(bad[:3]) if bad else 'none')" 2>/dev/null)
    [ "$residue" = "none" ] && ok "线上最新帖没有 e2e 残留" || ng "最新帖有 e2e 残留" "$residue"

    hc=$(http_code "$SITE/")
    [ "$hc" = "200" ] && ok "线上首页可访问（HTTP 200）" || ng "线上首页不可访问" "HTTP $hc"

    # 破坏性层跑完必须确认容器回到健康状态，否则下一次验收全是红的
    out=$(ssh_run 'for c in gateway user-service community-service content-service interaction-service \
        notification-service search-service rank-service elasticsearch; do
        printf "%s=%s\n" "$c" "$(docker inspect -f "{{.State.Health.Status}}" "kuaikan-$c-1" 2>/dev/null)"
      done')
    unhealthy=""
    for name in gateway user-service community-service content-service interaction-service \
                notification-service search-service rank-service elasticsearch; do
      st=$(printf '%s\n' "$out" | grep "^${name}=" | head -1 | cut -d= -f2)
      [ "$st" = "healthy" ] || unhealthy="$unhealthy ${name}(${st:-unknown})"
    done
    [ -z "$unhealthy" ] && ok "验收结束后 9 个应用容器 + ES 全部 healthy" \
      || ng "验收结束后有容器不健康" "$unhealthy"
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
printf '  %sP6 验收通过%s\n' "$G" "$N"
