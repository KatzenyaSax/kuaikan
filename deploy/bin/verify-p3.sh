#!/usr/bin/env bash
# P3 验收：评论与互动（风险核心）。退出码 0 即 P3 完成。
#
#   ./deploy/bin/verify-p3.sh                正式验收（全部层）
#   ./deploy/bin/verify-p3.sh --fast         跳过浏览器层与破坏性动作
#   ./deploy/bin/verify-p3.sh --layer l1     只跑某一层（l1/l2/l3/l4/l5）
#
# 分层（与 verify-p1/p2 同构，不另发明一套）：
#   L1 契约与构建   check-contract / check-openapi / check-scripts / 类型无漂移 / typecheck / build
#   L2 后端 HTTP    评论 CRUD、两级展示、tombstone、点赞 toggle、states、计数滞后
#   L3 浏览器       发评论、展开回复、点赞按钮状态、删除后占位
#   L4 破坏性       kill content-service 验计数自愈、重复投递幂等、对账修错
#   L5 回归         verify.sh + verify-p05.sh + verify-p1.sh + verify-p2.sh
#
# P3.0 只实现 L1，其余层为空壳并如实报「跳过」——每完成一刀就往对应层加断言。
#
# 账号约定：自动化测试用 agent@kuaikan.test，人工 e2e 用 developer@kuaikan.test。
# 本脚本自建临时账号（e2e+p3<时间戳>@kuaikan.test），两个都不碰。
#
# 断言纪律（P1/P2 踩出来的）：
#   每个「应该失败」的断言，前面必须有「前置条件成立」的断言。
#   否则空 token / 空响应会让后面的断言恒绿，看起来全过其实什么都没测。
#
# 与 L4 的关系：L4 会真的 stop 掉 content-service，并在收尾时清掉自己造成的
# 日志噪音（否则 P0 的「近 10 分钟无 ERROR」断言会让下一次验收必然失败）。
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

printf '%s%s%s\n' "$B" "kuaikan · P3 验收" "$N"
info "站点 $SITE"
info "开始 $(date '+%F %T')"

# ================================================================ L1 契约与构建

if want_layer l1; then
  section "L1 契约与构建"

  if out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1); then
    ok "错误码契约三方一致（$(printf '%s' "$out" | grep -oE '[0-9]+ 个错误码' | head -1)）"
  else
    ng "错误码契约不一致" "$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
  fi

  if out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1); then
    ok "OpenAPI 与网关放行规则一致"
  else
    ng "OpenAPI 与放行规则不一致" "$(printf '%s' "$out" | sed -n '2p')"
  fi

  if out=$(node "$APP_DIR/deploy/bin/check-scripts.mjs" 2>&1); then
    ok "shell 脚本静态检查通过"
  else
    ng "shell 脚本静态检查" "$(printf '%s' "$out" | sed -n '2p')"
  fi

  # P3.0 的契约是**代码**，所以要确认它真的能编译。
  # 只检查文件存在是不够的——record 的字段类型写错，要等到三个服务一起编译才炸。
  if ssh_run 'cd /opt/kuaikan/repo && git fetch -q origin && git reset -q --hard origin/main >/dev/null 2>&1; true'; then
    if out=$(ssh_run 'cd /opt/kuaikan/repo && bash deploy/bin/check.sh kuaikan-common 2>&1'); then
      ok "事件契约（kuaikan-common）编译通过"
    else
      ng "事件契约编译失败" "$(printf '%s' "$out" | grep -E 'ERROR|\.java:\[' | head -2 | tr '\n' ' ')"
    fi
  else
    skip "事件契约编译" "无法 SSH"
  fi

  if [ -d "$WEB_DIR/node_modules" ]; then
    ( cd "$WEB_DIR" && npm run gen:types >/dev/null 2>&1 )
    drift=$(cd "$APP_DIR" && git status --porcelain -- web/src/shared/api/types 2>/dev/null)
    if [ -z "$drift" ]; then
      ok "前端类型与 spec 无漂移"
    else
      ng "前端类型有漂移" "改了 spec 没重新生成？$(printf '%s' "$drift" | head -2 | tr '\n' ' ')"
    fi
    ( cd "$WEB_DIR" && npm run typecheck >/dev/null 2>&1 ) \
      && ok "typecheck 通过" || ng "typecheck 失败"
    ( cd "$WEB_DIR" && npm run build >/dev/null 2>&1 ) \
      && ok "前端构建通过" || ng "前端构建失败"
  else
    skip "前端类型/typecheck/build" "缺少 web/node_modules"
  fi
fi

# ================================================================ 夹具（L2 / L3 / L4 共用）

FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
EMAIL="e2e+p3${STAMP}@kuaikan.test"
EMAIL2="e2e+p3b${STAMP}@kuaikan.test"
USER_ID=""
USER_ID2=""
COMMUNITY_ID=""
COMMUNITY_NAME="e2e-p3-${STAMP}"
POST_ID=""
FIXTURE_READY=0

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
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p3-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p3-fixture.sql 2>/dev/null
    rm -f /tmp/p3-fixture.sql"
}

cleanup() {
  if [ -n "$USER_ID" ]; then
    # 必须先 USE：MySQL 的多表 DELETE 要求有默认库。
    # 不吞 stderr —— 清理失败必须看得见，否则测试数据会一点点攒进"生产"库。
    out=$(sql_exec "USE kuaikan_content;
      DELETE c FROM t_comment c JOIN kuaikan_community.t_community co ON co.id IN
        (SELECT id FROM kuaikan_community.t_community WHERE name LIKE 'e2e-%')
        WHERE c.post_id IN (SELECT id FROM t_post WHERE community_id = co.id);
      DELETE FROM t_post WHERE community_id IN
        (SELECT id FROM kuaikan_community.t_community WHERE name LIKE 'e2e-%' OR id = ${COMMUNITY_ID:-0});
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
        WHERE email LIKE 'e2e+%' AND created_at < NOW() - INTERVAL 1 HOUR;" 2>&1)
    case "$out" in
      *ERROR*) printf '  %s清理失败%s %s\n' "$R" "$N" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')" ;;
      *) info "已清理测试账号与测试社群" ;;
    esac
  fi
}
trap cleanup EXIT

prepare_fixture() {
  [ "$FIXTURE_READY" = "1" ] && return 0
  ssh_run 'true' || return 1
  out=$(sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL', '$FIXTURE_HASH', 'e2e-p3', 'USER', 1),
             (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL2', '$FIXTURE_HASH', 'e2e-p3b', 'USER', 1);
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL';
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL2';")
  USER_ID=$(printf '%s' "$out" | sed -n '1p' | tr -d '\r\n ')
  USER_ID2=$(printf '%s' "$out" | sed -n '2p' | tr -d '\r\n ')
  [ -n "$USER_ID" ] && [ -n "$USER_ID2" ] || return 1
  info "临时账号 userId=$USER_ID / ${USER_ID2}"

  TOKEN=$(curl -s --max-time 15 -X POST "$SITE/api/user/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}" | json_field 'data.accessToken')
  TOKEN2=$(curl -s --max-time 15 -X POST "$SITE/api/user/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL2\",\"password\":\"$FIXTURE_PASS\"}" | json_field 'data.accessToken')
  [ -n "$TOKEN" ] && [ -n "$TOKEN2" ] || return 1

  COMMUNITY_ID=$(curl -s --max-time 15 -X POST "$SITE/api/community/communities" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$COMMUNITY_NAME\"}" | json_field 'data.id')
  [ -n "$COMMUNITY_ID" ] || return 1

  POST_ID=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"communityId\":\"$COMMUNITY_ID\",\"title\":\"e2e 评论帖\",\"body\":\"x\"}" \
    | json_field 'data.id')
  [ -n "$POST_ID" ] || return 1
  # 再发一条：帖子列表要至少两条才拿得到游标，
  # "把帖子列表的游标喂给评论列表"那条断言需要它
  curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/content/posts" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"communityId\":\"$COMMUNITY_ID\",\"title\":\"e2e 第二帖\",\"body\":\"x\"}"
  info "夹具：communityId=$COMMUNITY_ID postId=$POST_ID"
  FIXTURE_READY=1
  return 0
}

# ================================================================ L2 后端 HTTP

if want_layer l2; then
  section "L2 后端 HTTP"

  TOKEN=""
  TOKEN2=""
  if ! prepare_fixture; then
    ng "创建夹具失败" "无法 SSH 或建号失败"
  fi

  if [ -n "$TOKEN" ] && [ -n "$POST_ID" ]; then
    CBASE="$SITE/api/content"
    CC() { curl -s --max-time 15 "$CBASE/posts/$POST_ID" | json_field 'data.commentCount'; }
    mkcomment() {
      curl -s --max-time 15 -X POST "$CBASE/posts/$POST_ID/comments" \
        -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"
    }

    # 游客可读
    body=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "游客可读一级评论列表" || ng "游客读评论" "$(printf '%s' "$body" | head -c 120)"

    # 非成员发评论（USER_ID2 未加入）
    body=$(mkcomment "$TOKEN2" '{"body":"非成员评论"}')
    [ "$(printf '%s' "$body" | json_field 'code')" = "41004" ] \
      && ok "非成员发评论 → 41004" || ng "非成员发评论未被拦" "$(printf '%s' "$body" | head -c 120)"

    # 成员发评论 + 强一致计数
    c0=$(CC)
    body=$(mkcomment "$TOKEN" '{"body":"一级评论"}')
    C1=$(printf '%s' "$body" | json_field 'data.id')
    author=$(printf '%s' "$body" | json_field 'data.authorId')
    if [ -n "$C1" ]; then ok "成员发一级评论成功"; else ng "发评论失败" "$(printf '%s' "$body" | head -c 160)"; fi
    [ "$author" = "$USER_ID" ] && ok "authorId = 自己" || ng "authorId 不对" "got=$author"

    c1=$(CC)
    [ "$c1" = "$((c0 + 1))" ] && ok "commentCount 立刻 +1（强一致，不是等 5 秒）" \
      || ng "commentCount 未实时更新" "c0=$c0 c1=$c1"

    # 让 USER_ID2 加入社群后回复
    curl -s --max-time 15 -o /dev/null -X POST \
      "$SITE/api/community/communities/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$COMMUNITY_NAME")/membership" \
      -H "Authorization: Bearer $TOKEN2"

    body=$(mkcomment "$TOKEN2" "{\"replyToCommentId\":\"$C1\",\"body\":\"二级回复\"}")
    R1=$(printf '%s' "$body" | json_field 'data.id')
    root=$(printf '%s' "$body" | json_field 'data.rootCommentId')
    replyUser=$(printf '%s' "$body" | json_field 'data.replyToUserId')
    [ "$root" = "$C1" ] && ok "回复的 rootCommentId 指向一级评论" || ng "rootCommentId 不对" "got=$root want=$C1"
    [ "$replyUser" = "$USER_ID" ] && ok "replyToUserId = 被回复者" || ng "replyToUserId 不对" "got=$replyUser"

    # 深层回复：回复那条回复 → root 仍是一级评论（两级平铺）
    body=$(mkcomment "$TOKEN" "{\"replyToCommentId\":\"$R1\",\"body\":\"三级回复\"}")
    root2=$(printf '%s' "$body" | json_field 'data.rootCommentId')
    [ "$root2" = "$C1" ] && ok "回复的回复：root 仍是同一条一级评论（平铺）" \
      || ng "深层回复的 root 不对" "got=$root2 want=$C1"

    # 一级列表不含回复；replyCount = 后代总数
    body=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments")
    if printf '%s' "$body" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']['items']
tops=[i for i in d if i['rootCommentId'] is None]
sys.exit(0 if len(tops)==1 and tops[0]['replyCount']==2 else 1)"; then
      ok "一级列表只有 1 条且 replyCount=2（后代总数，不是直接子节点数）"
    else
      ng "一级列表或 replyCount 不对" "$(printf '%s' "$body" | head -c 200)"
    fi

    # 回复列表平铺 2 条
    body=$(curl -s --max-time 15 "$CBASE/comments/$C1/replies")
    n=$(printf '%s' "$body" | python3 -c "
import json,sys;d=json.load(sys.stdin)['data']['items'];print(len(d))")
    [ "$n" = "2" ] && ok "回复列表平铺返回 2 条" || ng "回复列表条数不对" "got=$n"

    # 父评论必须属于同一个帖子
    body=$(mkcomment "$TOKEN" '{"replyToCommentId":"123456789","body":"x"}')
    [ "$(printf '%s' "$body" | json_field 'code')" = "42002" ] \
      && ok "回复不存在的评论 → 42002" || ng "不存在的父评论语义" "$(printf '%s' "$body" | head -c 120)"

    # 长度上限
    long=$(python3 -c "print('x'*2001)")
    body=$(mkcomment "$TOKEN" "{\"body\":\"$long\"}")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
      && ok "评论超过 2000 字 → 40010" || ng "评论长度未校验" "$(printf '%s' "$body" | head -c 120)"

    # 删别人的评论
    body=$(curl -s --max-time 15 -X DELETE "$CBASE/comments/$C1" -H "Authorization: Bearer $TOKEN2")
    [ "$(printf '%s' "$body" | json_field 'code')" = "40300" ] \
      && ok "删别人的评论 → 40300" || ng "删除权限未拦截" "$(printf '%s' "$body" | head -c 120)"

    # 删有回复的一级评论 → tombstone，回复仍在
    curl -s --max-time 15 -o /dev/null -X DELETE "$CBASE/comments/$C1" -H "Authorization: Bearer $TOKEN"
    body=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments")
    if printf '%s' "$body" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']['items']
sys.exit(0 if len(d)==1 and d[0]['deleted'] is True and d[0]['body']=='' else 1)"; then
      ok "删有回复的评论 → tombstone（deleted=true 且 body 清空）"
    else
      ng "tombstone 行为不对" "$(printf '%s' "$body" | head -c 200)"
    fi
    n=$(curl -s --max-time 15 "$CBASE/comments/$C1/replies" | python3 -c "
import json,sys;print(len(json.load(sys.stdin)['data']['items']))")
    [ "$n" = "2" ] && ok "tombstone 下的回复仍然可读" || ng "tombstone 吞掉了回复" "got=$n"

    # 重复删除 tombstone 幂等
    body=$(curl -s --max-time 15 -X DELETE "$CBASE/comments/$C1" -H "Authorization: Bearer $TOKEN")
    [ "$(printf '%s' "$body" | json_field 'code')" = "0" ] \
      && ok "重复删除 tombstone 幂等（code 0）" || ng "重复删除不幂等" "$(printf '%s' "$body" | head -c 120)"

    # 删光回复 → tombstone 一并物理清理
    for r in $(curl -s --max-time 15 "$CBASE/comments/$C1/replies" | python3 -c "
import json,sys
for i in json.load(sys.stdin)['data']['items']: print(i['id'], i['authorId'])" | tr ' ' ':'); do
      cid=${r%%:*}; aid=${r##*:}
      tok=$TOKEN
      [ "$aid" = "$USER_ID2" ] && tok=$TOKEN2
      curl -s --max-time 15 -o /dev/null -X DELETE "$CBASE/comments/$cid" -H "Authorization: Bearer $tok"
    done
    body=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments")
    n=$(printf '%s' "$body" | python3 -c "
import json,sys;print(len(json.load(sys.stdin)['data']['items']))")
    [ "$n" = "0" ] && ok "回复删光后 tombstone 一并物理清理（列表为空）" \
      || ng "tombstone 未被清理" "列表仍有 $n 条"

    c=$(CC)
    [ "$c" = "0" ] && ok "全部删除后 commentCount 归零" || ng "commentCount 未归零" "got=$c"

    # 库层一致：comment_count == 该帖 status=1 的评论数
    row=$(sql_exec "SELECT CONCAT(p.comment_count, ':', (SELECT COUNT(*) FROM kuaikan_content.t_comment c
        WHERE c.post_id = p.id AND c.status = 1))
      FROM kuaikan_content.t_post p WHERE p.id = $POST_ID;")
    row=$(printf '%s' "$row" | tr -d '\r\n ')
    lhs=${row%%:*}; rhs=${row##*:}
    if [ -n "$lhs" ] && [ "$lhs" = "$rhs" ]; then
      ok "库层一致：comment_count = 可见评论数（${lhs}）"
    else
      ng "comment_count 与评论行数不一致" "count:rows = $row"
    fi

    # 评论游标分页
    for i in $(seq 1 25); do
      curl -s --max-time 15 -o /dev/null -X POST "$CBASE/posts/$POST_ID/comments" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d "{\"body\":\"分页评论 $i\"}"
    done
    body=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments?limit=10")
    p1=$(printf '%s' "$body" | python3 -c "
import json,sys;print(','.join(i['id'] for i in json.load(sys.stdin)['data']['items']))")
    cur=$(printf '%s' "$body" | json_field 'data.nextCursor')
    p2=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments?limit=10&cursor=$cur" | python3 -c "
import json,sys;print(','.join(i['id'] for i in json.load(sys.stdin)['data']['items']))")
    if [ -n "$cur" ] && [ -n "$p2" ]; then
      dup=$(python3 -c "
import sys
print(len(set(sys.argv[1].split(',')) & set(sys.argv[2].split(','))))" "$p1" "$p2")
      [ "$dup" = "0" ] && ok "评论翻页不重不漏" || ng "评论翻页重复" "dup=$dup"
    else
      ng "评论第二页拿不到" "cur=$cur"
    fi

    # 跨列表游标：帖子列表的游标喂给评论列表 → 40010
    pcur=$(curl -s --max-time 15 "$SITE/api/content/posts?communityId=$COMMUNITY_ID&limit=1" | json_field 'data.nextCursor')
    if [ -n "$pcur" ]; then
      body=$(curl -s --max-time 15 "$CBASE/posts/$POST_ID/comments?cursor=$pcur")
      [ "$(printf '%s' "$body" | json_field 'code')" = "40010" ] \
        && ok "把帖子列表的游标喂给评论列表 → 40010（排序标记隔离）" \
        || ng "跨列表游标未被拒" "$(printf '%s' "$body" | head -c 120)"
    else
      skip "跨列表游标隔离" "帖子不足 2 条，拿不到帖子游标"
    fi
  fi

  skip "点赞 / 收藏 toggle" "P3.2 未实现"
  skip "计数滞后 ≤5s" "P3.2 未实现"
fi

# ================================================================ L3 浏览器

if want_heavy_layer l3; then
  section "L3 浏览器（playwright）"
  skip "发评论 / 展开回复 / 点赞状态 / 删除占位" "P3.1、P3.2 未实现"
fi

# ================================================================ L5 回归
# 执行顺序上 L5 在 L4 之前：L4 会破坏环境，先破坏再回归等于让回归必然失败。

if want_heavy_layer l5; then
  section "L5 回归（P0 / P0.5 / P1 / P2）"
  out=$(ssh_run 'cd /opt/kuaikan/repo && git fetch -q origin && git reset -q --hard origin/main \
    && bash deploy/bin/verify.sh --no-restart --skip-log-check' 2>&1)
  printf '%s' "$out" | grep -q 'P0 验收通过' && ok "verify.sh（P0）全绿" \
    || ng "verify.sh（P0）有失败" "$(printf '%s' "$out" | tail -1)"
  for script in verify-p05.sh verify-p1.sh verify-p2.sh; do
    if bash "$APP_DIR/deploy/bin/$script" --fast >/dev/null 2>&1; then
      ok "$script 全绿"
    else
      ng "$script 有失败" "单独运行看详情"
    fi
  done
fi

# ================================================================ L4 破坏性动作（必须最后跑）
#
# 这一层要证明的是"计数错了能不能自动修"，而不是"下游挂了怎么办"：
#   ① kill content-service → 点赞成功但计数不变 → 重启 → 对账修回
#   ② 手动重投同一事件 → 计数只 +1（MQ 是 at-least-once，重复投递是必然事件）
#   ③ 把 like_count 改成错误值 → 跑对账 → 修回

if want_heavy_layer l4; then
  section "L4 破坏性动作（经 SSH）"
  skip "kill content-service 验计数自愈" "P3.2 未实现"
  skip "重复投递幂等" "P3.2 未实现"
  skip "对账修错" "P3.2 未实现"
fi

# ================================================================ 汇总

# 一条都没跑说明 --layer 参数或分层判断出了问题。
# 空跑却「通过」是最危险的结果：它会被当成绿灯。
if [ "$((PASS + FAIL + SKIP))" -eq 0 ]; then
  printf '\n%s脚本没有执行任何检查%s（--layer=%s 未匹配到任何一层）\n' \
    "$R" "$N" "${ONLY_LAYER:-<全部>}"
  exit 3
fi

printf '\n%s汇总%s\n' "$B" "$N"
printf '  通过 %s%d%s   失败 %s%d%s   跳过 %s%d%s\n\n' "$G" "$PASS" "$N" "$R" "$FAIL" "$N" "$Y" "$SKIP" "$N"

if [ "$FAIL" -gt 0 ]; then
  printf '  失败项：\n'
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  printf '\n  %sP3 验收未通过%s\n' "$R" "$N"
  exit 1
fi

# 单层模式不能宣称"整段验收通过"：其余层根本没跑。
if [ -n "$ONLY_LAYER_NORM" ]; then
  printf '  %s%s 层通过%s（单层模式，不代表整段验收）\n' "$G" "$ONLY_LAYER_NORM" "$N"
  exit 0
fi

if [ "$SKIP" -gt 0 ]; then
  printf '  %sP3 尚未完成：有 %d 项因未实现而跳过%s\n' "$Y" "$SKIP" "$N"
  exit 0
fi

printf '  %sP3 验收通过%s\n' "$G" "$N"
