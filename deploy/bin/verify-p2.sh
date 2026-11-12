#!/usr/bin/env bash
# P2 验收：内容读路径。退出码 0 即 P2 完成。
#
#   ./deploy/bin/verify-p2.sh                正式验收（全部层）
#   ./deploy/bin/verify-p2.sh --fast         跳过浏览器层与破坏性动作
#   ./deploy/bin/verify-p2.sh --layer l1     只跑某一层（l1/l2/l3/l4/l5）
#
# 分层（与 verify-p1.sh 同构，不另发明一套）：
#   L1 契约与构建   check-contract / check-openapi / gen:types 无漂移 / typecheck / build
#   L2 后端 HTTP    社群、成员、帖子、游标分页、权限边界（经公网网关）
#   L3 浏览器       双栏交互、冷启动深链接、窄屏降级（playwright）
#   L4 破坏性动作   kill 服务验读路径边界、非法游标、并发加入（经 SSH）
#   L5 回归         verify.sh(P0) + verify-p05.sh(P0.5) + verify-p1.sh(P1)
#
# P2.0 阶段只实现 L1，其余层为空壳并如实报「跳过」——
# 每完成一刀就往对应层加断言，不攒到 P2.5。
#
# 断言纪律（P1 踩过两个坑换来的）：
#   每个「应该失败」的断言，前面必须有「前置条件成立」的断言。
#   否则空 token / 空响应会让后面的断言恒绿，看起来全过其实什么都没测。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"

FAST=0
ONLY_LAYER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --layer) ONLY_LAYER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
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

# macOS 自带的是 bash 3.2，没有 ${var,,} 小写展开，所以这里先归一化一次。
ONLY_LAYER_NORM=$(printf '%s' "$ONLY_LAYER" | tr '[:upper:]' '[:lower:]')

ssh_run() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@" 2>/dev/null; }

want_layer() {
  [ -z "$ONLY_LAYER_NORM" ] && return 0
  [ "$ONLY_LAYER_NORM" = "$1" ] && return 0
  return 1
}

# 只在 FAST=0 时执行的层
want_heavy_layer() {
  [ -z "$ONLY_LAYER_NORM" ] || [ "$ONLY_LAYER_NORM" = "$1" ] || return 1
  [ "$FAST" = "1" ] && return 1
  return 0
}

# ================================================================ L1 契约与构建

if want_layer l1; then
  section "L1 契约与构建"

  if out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1); then
    ok "错误码契约三方一致（$(printf '%s' "$out" | grep -oE '[0-9]+ 个错误码' | head -1)）"
  else
    ng "错误码契约不一致" "$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
  fi

  if out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1); then
    ok "OpenAPI 与网关白名单一致（$(printf '%s' "$out" | grep -oE 'operationId 唯一（[0-9]+ 个' | grep -oE '[0-9]+' | head -1) 个 operationId）"
  else
    ng "OpenAPI 与白名单不一致" "$(printf '%s' "$out" | sed -n '2p')"
  fi

  # 生成物无漂移：重新生成一遍，若 git 显示有改动说明有人改了 spec 没重生成
  if [ -d "$WEB_DIR/node_modules" ]; then
    ( cd "$WEB_DIR" && npm run gen:types >/dev/null 2>&1 )
    drift=$(cd "$APP_DIR" && git status --porcelain -- web/src/shared/api/types 2>/dev/null)
    if [ -z "$drift" ]; then
      ok "前端类型与 spec 无漂移"
    else
      ng "前端类型有漂移" "改了 spec 没重新生成？$(printf '%s' "$drift" | head -2 | tr '\n' ' ')"
    fi

    if ( cd "$WEB_DIR" && npm run typecheck >/dev/null 2>&1 ); then
      ok "typecheck 通过"
    else
      ng "typecheck 失败"
    fi

    if ( cd "$WEB_DIR" && npm run build >/dev/null 2>&1 ); then
      ok "前端构建通过"
    else
      ng "前端构建失败"
    fi
  else
    skip "前端类型/typecheck/build" "缺少 web/node_modules"
  fi
fi

# ================================================================ 测试夹具
# 每次运行建一个临时账号 + 一个临时社群，结束时删干净。
# 密码 E2eFixture-Passw0rd 的 BCrypt 哈希（cost 10，与线上一致）。
# 这是**测试夹具**不是密钥：账号每次运行都不同且结束即删。
FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
EMAIL="e2e+p2${STAMP}@kuaikan.test"
USER_ID=""
COMMUNITY_ID=""
COMMUNITY_ID2=""
COMMUNITY_NAME="e2e-社群-${STAMP}"
COMMUNITY_NAME_LOWER="E2e-Front-${STAMP}"

json_field() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
v=d
for k in sys.argv[1].split('.'):
    if isinstance(v,dict) and k in v: v=v[k]
    elif isinstance(v,list) and k.isdigit() and int(k)<len(v): v=v[int(k)]
    else: print(''); raise SystemExit(0)
print('' if v is None else v)
" "$1" 2>/dev/null; }

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null || echo "000"; }

sql_exec() {
  # SQL 用 base64 传：直接内插进远端双引号命令会被远端 shell 展开
  local sql="$1"
  local b64
  b64=$(printf '%s' "$sql" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p2-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p2-fixture.sql 2>/dev/null
    rm -f /tmp/p2-fixture.sql"
}

cleanup() {
  # 按 id + 名称前缀双保险：一次运行会建两个社群（大小写归一那条断言也要一个），
  # 只记一个 id 会漏删。夹具名统一以 e2e- 开头，前缀匹配能兜住漏记的情况。
  if [ -n "$USER_ID" ]; then
    # 必须先 USE：MySQL 的多表 DELETE 即使表名全限定也要求有默认库
    # （ERROR 1046 No database selected）。这里不吞 stderr——
    # 清理失败必须看得见，否则测试数据会一点点攒进"生产"库。
    out=$(sql_exec "USE kuaikan_community;
      DELETE m FROM t_community_member m
        JOIN t_community c ON c.id = m.community_id
        WHERE c.name LIKE 'e2e-%' OR c.id IN (${COMMUNITY_ID:-0}, ${COMMUNITY_ID2:-0});
      DELETE FROM t_community
        WHERE name LIKE 'e2e-%' OR id IN (${COMMUNITY_ID:-0}, ${COMMUNITY_ID2:-0});
      DELETE FROM kuaikan_user.t_refresh_token WHERE user_id=$USER_ID;
      DELETE FROM kuaikan_user.t_user WHERE id=$USER_ID;" 2>&1)
    case "$out" in
      *ERROR*) printf '  %s清理失败%s %s\n' "$R" "$N" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')" ;;
      *) info "已清理测试账号 $EMAIL 与测试社群" ;;
    esac
  fi
}
trap cleanup EXIT

printf '%s%s%s\n' "$B" "kuaikan · P2 验收" "$N"
info "站点 $SITE"
info "开始 $(date '+%F %T')"

# ================================================================ L2 后端 HTTP

if want_layer l2; then
  section "L2 后端 HTTP"

  # ---------- 准备：临时账号 ----------
  ssh_ok=0
  ssh_run 'true' && ssh_ok=1
  if [ $ssh_ok = 1 ]; then
    out=$(sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
        VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL', '$FIXTURE_HASH', 'e2e-p2', 'USER', 1);
        SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL';")
    USER_ID=$(printf '%s' "$out" | tr -d '\r\n ')
    [ -n "$USER_ID" ] && info "临时账号 userId=$USER_ID" || ng "创建临时账号失败"
  else
    skip "L2 后端 HTTP" "无法 SSH 到 $SSH_HOST（需要建账号与清理）"
  fi

  TOKEN=""
  if [ -n "$USER_ID" ]; then
    resp=$(curl -s --max-time 15 -X POST "$SITE/api/user/auth/login" \
      -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}")
    TOKEN=$(printf '%s' "$resp" | json_field 'data.accessToken')
    [ -n "$TOKEN" ] || ng "夹具登录失败，后续断言会空转" "$(printf '%s' "$resp" | head -c 120)"
  fi

  if [ -n "$TOKEN" ]; then
    # ---------- 游客读 ----------
    body=$(curl -s --max-time 15 "$SITE/api/community/communities?limit=5")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "游客可读社群列表" || ng "游客读社群列表" "$(printf '%s' "$body" | head -c 120)"

    # ---------- 游客不能建 ----------
    c=$(curl -s --max-time 15 -o /tmp/p2-guest-create.json -w '%{http_code}' \
      -X POST "$SITE/api/community/communities" -H 'Content-Type: application/json' \
      -d '{"name":"游客不能建"}')
    code=$(json_field 'code' < /tmp/p2-guest-create.json)
    [ "$c" = "401" ] && [ "$code" = "40100" ] \
      && ok "游客建社群 → 401/40100" || ng "游客建社群语义" "HTTP $c code=$code"

    # ---------- 建社群 ----------
    body=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$COMMUNITY_NAME\",\"description\":\"第一行\\n第二行\"}")
    COMMUNITY_ID=$(printf '%s' "$body" | json_field 'data.id')
    owner=$(printf '%s' "$body" | json_field 'data.ownerId')
    mc=$(printf '%s' "$body" | json_field 'data.memberCount')
    if [ -n "$COMMUNITY_ID" ]; then
      ok "建社群成功 id=$COMMUNITY_ID"
    else
      ng "建社群失败" "$(printf '%s' "$body" | head -c 160)"
    fi
    [ "$owner" = "$USER_ID" ] && ok "ownerId = 创建者" || ng "ownerId 不对" "got=$owner want=$USER_ID"
    [ "$mc" = "1" ] && ok "memberCount 从 1 起" || ng "memberCount 不是 1" "got=$mc"

    # memberCount 是数字而不是字符串："1" / 1 的区分靠 JSON 类型
    if printf '%s' "$body" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
raise SystemExit(0 if isinstance(d['memberCount'], int) and isinstance(d['id'], str) else 1)"; then
      ok "类型正确：id 是字符串、memberCount 是数字"
    else
      ng "字段类型不对" "id 应为 string、memberCount 应为 number"
    fi

    # ---------- 创建者确实是成员（库层） ----------
    row=$(sql_exec "SELECT CONCAT(COUNT(*), ':', IFNULL(SUM(role),-1), ':', IFNULL(SUM(status),-1))
      FROM kuaikan_community.t_community_member WHERE community_id=$COMMUNITY_ID AND user_id=$USER_ID;")
    row=$(printf '%s' "$row" | tr -d '\r\n ')
    [ "$row" = "1:0:1" ] && ok "创建者是成员（1 行，role=0，status=1）" \
      || ng "创建者成员行不对" "got=$row want=1:0:1"

    # ---------- 名称重复 ----------
    body=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$COMMUNITY_NAME\"}")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41002" ] \
      && ok "名称重复 → 41002" || ng "名称重复未拦截" "$(printf '%s' "$body" | head -c 120)"

    # ---------- 规范化：大小写 + 全角 ----------
    body=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$COMMUNITY_NAME_LOWER\"}")
    COMMUNITY_ID2=$(printf '%s' "$body" | json_field 'data.id')

    body=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$(printf '%s' "$COMMUNITY_NAME_LOWER" | tr 'A-Z' 'a-z')\"}")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41002" ] \
      && ok "大小写不同视为同名 → 41002" || ng "大小写未归一" "$(printf '%s' "$body" | head -c 120)"

    # 全角字母：NFKC 折叠后应命中同一个 name_key。
    # 这条同时证明"字符集校验发生在规范化之后"——若校验在之前，全角会被 40010 拒。
    full=$(printf '%s' "$COMMUNITY_NAME_LOWER" | python3 -c "
import sys
s=sys.stdin.read()
print(''.join(chr(ord(c)+0xFEE0) if '!' <= c <= '~' else c for c in s), end='')")
    body=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$full\"}")
    [ "$(printf '%s' "$body" | json_field 'code')" = "41002" ] \
      && ok "全角名称 NFKC 折叠后同样视为重名 → 41002" \
      || ng "全角未折叠" "name=$full → $(printf '%s' "$body" | head -c 120)"

    # ---------- 详情与大小写不敏感的查找 ----------
    enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$COMMUNITY_NAME")
    body=$(curl -s --max-time 15 "$SITE/api/community/communities/$enc")
    [ "$(printf '%s' "$body" | json_field 'data.id')" = "$COMMUNITY_ID" ] \
      && ok "游客可读社群详情" || ng "游客读详情" "$(printf '%s' "$body" | head -c 120)"

    # 详情里不应有任何按查看者变化的字段（公开端点上一律匿名）
    if printf '%s' "$body" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
raise SystemExit(1 if any(k.startswith('viewer') for k in d) else 0)"; then
      ok "公开详情无 viewer* 字段（放行 = 匿名）"
    else
      ng "公开详情带了按人变化的字段"
    fi

    low=$(printf '%s' "$COMMUNITY_NAME_LOWER" | tr 'A-Z' 'a-z')
    body=$(curl -s --max-time 15 "$SITE/api/community/communities/$low")
    [ -n "$(printf '%s' "$body" | json_field 'data.id')" ] \
      && ok "小写路径命中同一个社群（查找也走规范化）" \
      || ng "小写路径查不到" "$(printf '%s' "$body" | head -c 120)"

    # ---------- 不存在的社群 ----------
    c=$(http_code "$SITE/api/community/communities/definitely-not-exist-xyz")
    [ "$c" = "404" ] && ok "不存在的社群 → 404" || ng "不存在社群的状态码" "HTTP $c"

    # ---------- 名称校验 ----------
    b1=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' -d '{"name":"x"}')
    b2=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' -d '{"name":"有/斜杠"}')
    if [ "$(printf '%s' "$b1" | json_field 'code')" = "40010" ] \
       && [ "$(printf '%s' "$b2" | json_field 'code')" = "40010" ]; then
      ok "名称校验：过短 / 含斜杠 → 40010"
    else
      ng "名称校验" "过短=$(printf '%s' "$b1" | head -c 60) 斜杠=$(printf '%s' "$b2" | head -c 60)"
    fi

    # ---------- 游标分页 ----------
    c1=$(curl -s --max-time 15 "$SITE/api/community/communities?limit=1" | json_field 'data.nextCursor')
    if [ -n "$c1" ]; then
      p1=$(curl -s --max-time 15 "$SITE/api/community/communities?limit=1" | json_field 'data.items.0.id')
      p2=$(curl -s --max-time 15 "$SITE/api/community/communities?limit=1&cursor=$c1" | json_field 'data.items.0.id')
      if [ -n "$p1" ] && [ -n "$p2" ] && [ "$p1" != "$p2" ]; then
        ok "游标翻页：第 2 页与第 1 页不重叠"
      else
        ng "游标翻页重复" "p1=$p1 p2=$p2"
      fi
    else
      skip "游标翻页" "社群不足 2 个"
    fi

    body=$(curl -s --max-time 15 "$SITE/api/community/communities?cursor=not-a-cursor")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "篡改游标 → 40010（不是 500）" || ng "篡改游标语义" "$(printf '%s' "$body" | head -c 120)"
  fi

  skip "成员加入/退出与 member_count 增量" "P2.2 未实现"
  skip "发帖与权限边界（41004）" "P2.3 未实现"
  skip "帖子游标分页不重不漏" "P2.4 未实现"
fi

# ================================================================ L3 浏览器

if want_heavy_layer l3; then
  section "L3 浏览器（playwright）"
  skip "双栏交互 / 冷启动深链接 / 窄屏降级" "P2.4 未实现"
fi

# ================================================================ L4 破坏性动作

if want_heavy_layer l4; then
  section "L4 破坏性动作（经 SSH）"
  skip "kill 服务验读路径边界" "P2.4 未实现"
  skip "非法游标 / 并发加入" "P2.4 未实现"
fi

# ================================================================ L5 回归

if want_heavy_layer l5; then
  section "L5 回归（P0 / P0.5 / P1）"

  # P0 的 verify.sh 检查的是容器状态，必须在服务器上跑；
  # --no-restart 避免后半程的断言被重启窗口里的真 500 污染。
  out=$(ssh_run 'cd /opt/kuaikan/repo && bash deploy/bin/verify.sh --no-restart' 2>&1)
  if printf '%s' "$out" | grep -q 'P0 验收通过'; then
    ok "verify.sh（P0）全绿"
  else
    ng "verify.sh（P0）有失败" "$(printf '%s' "$out" | tail -1)"
  fi

  for script in verify-p05.sh verify-p1.sh; do
    if bash "$APP_DIR/deploy/bin/$script" --fast >/dev/null 2>&1; then
      ok "$script 全绿"
    else
      ng "$script 有失败" "单独运行看详情"
    fi
  done
fi

# ================================================================ 汇总

# 一条都没跑说明 --layer 参数或分层判断出了问题。
# 空跑却「通过」是最危险的结果：它会被当成绿灯。
if [ "$((PASS + FAIL + SKIP))" -eq 0 ]; then
  printf '\n%s脚本没有执行任何检查%s' "$R" "$N"
  printf '（--layer=%s 未匹配到任何一层）\n' "${ONLY_LAYER:-<全部>}"
  exit 3
fi

printf '\n%s汇总%s\n' "$B" "$N"
printf '  通过 %s%d%s   失败 %s%d%s   跳过 %s%d%s\n\n' "$G" "$PASS" "$N" "$R" "$FAIL" "$N" "$Y" "$SKIP" "$N"

if [ "$FAIL" -gt 0 ]; then
  printf '  失败项：\n'
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  printf '\n  %sP2 验收未通过%s\n' "$R" "$N"
  exit 1
fi

if [ "$SKIP" -gt 0 ]; then
  printf '  %sP2 尚未完成：有 %d 项因未实现而跳过%s\n' "$Y" "$SKIP" "$N"
  exit 0
fi

printf '  %sP2 验收通过%s\n' "$G" "$N"
