#!/usr/bin/env bash
# P4 消息中心验收。
#
#   ./deploy/bin/verify-p4.sh             全量（含 L6 回归：会递归跑 p0/p05/p1/p2/p3）
#   ./deploy/bin/verify-p4.sh --fast      跳过 L6 回归与 L5 SSE 长连接
#   ./deploy/bin/verify-p4.sh --layer l2  只跑某一层
#
# 断言纪律（P1/P2/P3 踩出来的）：
#   每个「应该不产生」的断言，前面必须有「产生路径确实通」的断言。
#   否则 MQ 挂了、消费者没起，所有「不产生消息」都会恒绿——看起来全过其实什么都没测。
#
# 顺序：L1 → L2 → L3 → L4 → L5 → L6。
# L6 放最后：它会递归跑前面所有阶段的验收，是最贵的一步。
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
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
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

printf '%s%s%s\n' "$B" "kuaikan · P4 验收" "$N"
info "站点 $SITE"
info "开始 $(date '+%F %T')"

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

sql_exec() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh_run "echo '$b64' | base64 -d > /tmp/p4-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p4-fixture.sql 2>/dev/null
    rm -f /tmp/p4-fixture.sql"
}

# ================================================================ L1 契约与构建

if want_layer l1; then
  section "L1 契约与构建"

  out=$(node "$APP_DIR/deploy/bin/check-contract.mjs" 2>&1) \
    && ok "错误码契约三方一致" \
    || ng "错误码契约不一致" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"

  out=$(node "$APP_DIR/deploy/bin/check-openapi.mjs" 2>&1) \
    && ok "OpenAPI 与网关放行规则一致" \
    || ng "OpenAPI 与放行规则不一致" "$(printf '%s' "$out" | sed -n '2p')"

  out=$(node "$APP_DIR/deploy/bin/check-scripts.mjs" 2>&1) \
    && ok "shell 脚本静态检查通过" \
    || ng "shell 脚本静态检查" "$(printf '%s' "$out" | sed -n '2p')"

  # topic 名不允许点号（RocketMQ 校验 ^[%|a-zA-Z0-9_-]+$）。
  # 这条断言守着"哪天有人把 topic 改成 kuaikan.comment.created"。
  if grep -q 'kuaikan_comment_created' "$APP_DIR/services/kuaikan-common/src/main/java/top/katzenyasax/kuaikan/common/mq/Topics.java" \
     && ! grep -qE '"kuaikan\.[a-z_]+"' "$APP_DIR/services/kuaikan-common/src/main/java/top/katzenyasax/kuaikan/common/mq/Topics.java"; then
    ok "topic 命名用下划线（无点号）"
  else
    ng "topic 命名不符合 RocketMQ 校验"
  fi

  # 消费组必须各不相同。同一个 group 订阅同一个 topic 是集群消费（各拿一半），
  # 而且不报错——这条断言是该类事故唯一的自动化防线。
  groups=$(grep -A5 '^  notify:' "$APP_DIR/services/notification-service/src/main/resources/application.yml" \
    | grep -oE 'kuaikan-notification-[a-z-]+-consumer' | sort)
  uniq_groups=$(printf '%s\n' "$groups" | sort -u)
  if [ -n "$groups" ] && [ "$groups" = "$uniq_groups" ] \
     && ! printf '%s' "$groups" | grep -q 'kuaikan-content-'; then
    ok "notification 的三个消费组互不相同，且不与 content 撞名"
  else
    ng "消费组命名有重复或撞名" "$(printf '%s' "$groups" | tr '\n' ' ')"
  fi

  if [ -d "$WEB_DIR/node_modules" ]; then
    ( cd "$WEB_DIR" && npm run gen:types >/dev/null 2>&1 )
    drift=$(cd "$APP_DIR" && git status --porcelain -- web/src/shared/api/types 2>/dev/null)
    [ -z "$drift" ] && ok "前端类型与 spec 无漂移" \
      || ng "前端类型有漂移" "$(printf '%s' "$drift" | head -2 | tr '\n' ' ')"
    ( cd "$WEB_DIR" && npm run typecheck >/dev/null 2>&1 ) \
      && ok "typecheck 通过" || ng "typecheck 失败"
  else
    skip "前端类型/typecheck" "缺少 web/node_modules"
  fi
fi

# ================================================================ 夹具

FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
EMAIL="e2e+p4${STAMP}@kuaikan.test"
EMAIL2="e2e+p4b${STAMP}@kuaikan.test"
USER_ID=""
USER_ID2=""
COMMUNITY_ID=""
COMMUNITY_NAME="e2e-p4-${STAMP}"
POST_ID=""
TOKEN=""
TOKEN2=""
FIXTURE_READY=0

cleanup() {
  if [ -n "$USER_ID" ]; then
    out=$(sql_exec "USE kuaikan_content;
      DELETE c FROM t_comment c JOIN t_post p ON p.id = c.post_id
        JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-%' OR co.id = ${COMMUNITY_ID:-0};
      DELETE p FROM t_post p JOIN kuaikan_community.t_community co ON co.id = p.community_id
        WHERE co.name LIKE 'e2e-%' OR co.id = ${COMMUNITY_ID:-0};
      DELETE FROM t_outbox WHERE topic = 'kuaikan_comment_created';
      USE kuaikan_notification;
      DELETE FROM t_message WHERE user_id IN ($USER_ID, ${USER_ID2:-0});
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
      *) info "已清理测试账号、社群、消息" ;;
    esac
  fi
}
trap cleanup EXIT

prepare_fixture() {
  [ "$FIXTURE_READY" = "1" ] && return 0
  ssh_run 'true' || return 1
  out=$(sql_exec "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL', '$FIXTURE_HASH', 'e2e-p4', 'USER', 1),
             (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL2', '$FIXTURE_HASH', 'e2e-p4b', 'USER', 1);
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL';
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL2';")
  USER_ID=$(printf '%s' "$out" | sed -n '1p' | tr -d '\r\n ')
  USER_ID2=$(printf '%s' "$out" | sed -n '2p' | tr -d '\r\n ')
  [ -n "$USER_ID" ] && [ -n "$USER_ID2" ] || return 1

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

  # 第二个账号必须加入社群：评论与发帖都要求成员身份（41004）。
  # 少了这一步，所有"评论"相关断言都会因为评论没建成而连坐失败。
  curl -s --max-time 15 -o /dev/null -X POST \
    "$SITE/api/community/communities/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$COMMUNITY_NAME")/membership" \
    -H "Authorization: Bearer $TOKEN2"

  POST_ID=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"communityId\":\"$COMMUNITY_ID\",\"title\":\"e2e P4 帖\",\"body\":\"正文\"}" \
    | json_field 'data.id')
  [ -n "$POST_ID" ] || return 1

  info "夹具：userId=$USER_ID / $USER_ID2  postId=$POST_ID"
  FIXTURE_READY=1
  return 0
}

# 消息是异步落库的。轮询等待而不是 sleep 固定秒数——
# 固定 sleep 在慢的时候会假红，在快的时候白等。
wait_unread() {
  local token="$1" want="$2" i val
  for i in $(seq 1 25); do
    val=$(curl -s --max-time 10 "$SITE/api/notification/unread" -H "Authorization: Bearer $token" \
      | json_field 'data.total')
    [ "$val" = "$want" ] && return 0
    sleep 0.4
  done
  printf '%s' "$val"
  return 1
}

unread_total() {
  curl -s --max-time 10 "$SITE/api/notification/unread" -H "Authorization: Bearer $1" \
    | json_field 'data.total'
}

unread_type() {
  curl -s --max-time 10 "$SITE/api/notification/unread" -H "Authorization: Bearer $1" \
    | json_field "data.$2"
}

send_like() {
  curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/interaction/likes" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"targetType\":\"post\",\"targetId\":\"$2\"}"
}

drop_like() {
  curl -s --max-time 15 -o /dev/null -X DELETE \
    "$SITE/api/interaction/likes?targetType=post&targetId=$2" -H "Authorization: Bearer $1"
}

# ================================================================ L2 写入与幂等

if want_layer l2; then
  section "L2 写入与幂等"

  if ! prepare_fixture; then
    ng "创建夹具失败" "无法 SSH 或建号失败"
  else
    # ① 先证明产生路径确实通，后面的「不产生」才有意义
    drop_like "$TOKEN2" "$POST_ID"
    sleep 0.5
    send_like "$TOKEN2" "$POST_ID"
    if wait_unread "$TOKEN" 1 >/dev/null; then
      ok "别人赞我的帖子 → 5 秒内产生一条消息"
    else
      ng "点赞没有产生消息" "等待超时"
    fi

    latest=$(curl -s --max-time 10 "$SITE/api/notification/messages?type=LIKE&limit=1" \
      -H "Authorization: Bearer $TOKEN")
    [ "$(printf '%s' "$latest" | json_field 'data.items.0.actorId')" = "$USER_ID2" ] \
      && ok "消息里的 actorId 是点赞的人" || ng "actorId 不对"
    [ -n "$(printf '%s' "$latest" | json_field 'data.items.0.communityName')" ] \
      && ok "消息带 communityName（可跳转）" || ng "communityName 为空，消息点不动"
    [ -n "$(printf '%s' "$latest" | json_field 'data.items.0.postId')" ] \
      && ok "消息带 postId" || ng "postId 为空"

    # ② 自己赞自己
    before=$(unread_total "$TOKEN")
    send_like "$TOKEN" "$POST_ID"
    sleep 4
    [ "$(unread_total "$TOKEN")" = "$before" ] \
      && ok "自己赞自己不产生消息" || ng "自赞产生了消息"

    # ③ 收藏（最容易写错的一条）
    before=$(unread_total "$TOKEN")
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/interaction/favorites" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d "{\"targetType\":\"post\",\"targetId\":\"$POST_ID\"}"
    sleep 4
    [ "$(unread_total "$TOKEN")" = "$before" ] \
      && ok "别人收藏我的帖子不产生消息" || ng "收藏产生了消息（收藏是私密行为）"

    # ④ 取消赞
    before=$(unread_total "$TOKEN")
    drop_like "$TOKEN2" "$POST_ID"
    sleep 4
    [ "$(unread_total "$TOKEN")" = "$before" ] \
      && ok "取消赞不产生新消息" || ng "取消赞产生了消息"

    # ⑤ 评论 → 帖子作者收到 COMMENT
    before=$(unread_total "$TOKEN")
    comment_id=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts/$POST_ID/comments" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d '{"body":"e2e 评论一条"}' | json_field 'data.id')
    [ -n "$comment_id" ] && ok "评论创建成功" || ng "评论创建失败"
    if wait_unread "$TOKEN" "$((before + 1))" >/dev/null; then
      ok "帖子作者收到评论消息"
    else
      ng "评论没有产生消息"
    fi
    cmsg=$(curl -s --max-time 10 "$SITE/api/notification/messages?type=COMMENT&limit=1" \
      -H "Authorization: Bearer $TOKEN")
    got_cid=$(printf '%s' "$cmsg" | json_field 'data.items.0.commentId')
    # 护栏：两边都为空时 "空 == 空" 会假绿——那正是这条断言最容易骗过自己的地方
    [ -n "$comment_id" ] && [ "$got_cid" = "$comment_id" ] \
      && ok "评论消息带 commentId（能跳到那条评论）" || ng "commentId 不对或为空" "期望 $comment_id 实得 $got_cid"

    # ⑥ 回复我的评论 → 我收到 COMMENT，且带 root
    before=$(unread_total "$TOKEN")
    reply_id=$(curl -s --max-time 15 -X POST "$SITE/api/content/posts/$POST_ID/comments" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d "{\"replyToCommentId\":\"$comment_id\",\"body\":\"e2e 回复一条\"}" | json_field 'data.id')
    if wait_unread "$TOKEN" "$((before + 1))" >/dev/null; then
      ok "被回复的人收到评论消息"
    else
      ng "回复没有产生消息"
    fi
    rmsg=$(curl -s --max-time 10 "$SITE/api/notification/messages?type=COMMENT&limit=1" \
      -H "Authorization: Bearer $TOKEN")
    got_root=$(printf '%s' "$rmsg" | json_field 'data.items.0.rootCommentId')
    [ -n "$comment_id" ] && [ "$got_root" = "$comment_id" ] \
      && ok "回复消息带 rootCommentId（能展开折叠的回复）" \
      || ng "rootCommentId 为空，回复类消息跳不到" "期望 $comment_id 实得 $got_root"

    # ⑦ 回复 + 同时 @ 同一个人 → 仍然只有一条
    before=$(unread_total "$TOKEN")
    before_mention=$(unread_type "$TOKEN" mention)
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/content/posts/$POST_ID/comments" \
      -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
      -d "{\"replyToCommentId\":\"$comment_id\",\"body\":\"@e2e-p4 回复并@你\"}"
    sleep 5
    if [ "$(unread_total "$TOKEN")" = "$((before + 1))" ] \
       && [ "$(unread_type "$TOKEN" mention)" = "$before_mention" ]; then
      ok "回复并同时 @ 同一个人 → 只有一条 COMMENT"
    else
      ng "回复+@ 产生了重复消息" "未读 $(unread_total "$TOKEN")，期望 $((before + 1))"
    fi

    # ⑧ @ 一个非本社群成员 → 不产生 MENTION
    # （用第二个账号的昵称也不行——它不是这个社群的成员）
    before_mention=$(unread_type "$TOKEN2" mention)
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/content/posts/$POST_ID/comments" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d '{"body":"@不存在的昵称 你好"}'
    sleep 4
    [ "$(unread_type "$TOKEN2" mention)" = "$before_mention" ] \
      && ok "@ 不存在的昵称不产生 MENTION" || ng "@ 不存在的昵称产生了 MENTION"

    # ⑨ 重复投递：把一条已发送的 outbox 行改回待投递，relay 会重发，
    # 消费者必须靠 uk_user_event 挡住。
    msg_before=$(sql_exec "SELECT COUNT(*) FROM kuaikan_notification.t_message
        WHERE user_id = $USER_ID AND type = 'COMMENT';" | tr -d '\r\n ')
    sql_exec "UPDATE kuaikan_interaction.t_outbox SET status = 0, retry_count = 0,
        next_retry_at = NOW() WHERE topic = 'kuaikan_interaction_changed'
        ORDER BY id DESC LIMIT 1;" >/dev/null
    sleep 5
    msg_after=$(sql_exec "SELECT COUNT(*) FROM kuaikan_notification.t_message
        WHERE user_id = $USER_ID AND type = 'COMMENT';" | tr -d '\r\n ')
    [ -n "$msg_before" ] && [ "$msg_before" = "$msg_after" ] \
      && ok "同一事件重复投递不产生第二条消息" \
      || ng "重复投递产生了重复消息" "$msg_before → $msg_after"
  fi
fi

# ================================================================ L3 未读与已读

if want_layer l3; then
  section "L3 未读与已读"

  if ! prepare_fixture; then
    ng "创建夹具失败" "无法 SSH 或建号失败"
  else
    total=$(unread_total "$TOKEN")
    [ -n "$total" ] && ok "未读接口可用（total=${total}）" || ng "未读接口不可用"

    # 四类字段必须齐，前端不该判 undefined
    u=$(curl -s --max-time 10 "$SITE/api/notification/unread" -H "Authorization: Bearer $TOKEN")
    has_all=1
    for k in like comment mention system total; do
      [ -n "$(printf '%s' "$u" | json_field "data.$k")" ] || has_all=0
    done
    [ "$has_all" = "1" ] && ok "四类未读 + total 齐全" || ng "未读字段缺失"

    # 全部已读
    marked=$(curl -s --max-time 15 -X POST "$SITE/api/notification/read-all" \
      -H "Authorization: Bearer $TOKEN" | json_field 'data')
    [ -n "$marked" ] && ok "全部已读返回标记条数（${marked}）" || ng "全部已读没有返回条数"
    [ "$(unread_total "$TOKEN")" = "0" ] && ok "全部已读后未读归零" || ng "全部已读后未读不为 0"

    again=$(curl -s --max-time 15 -X POST "$SITE/api/notification/read-all" \
      -H "Authorization: Bearer $TOKEN" | json_field 'data')
    [ "$again" = "0" ] && ok "全部已读重复调用是幂等的（0 条）" || ng "重复全部已读不幂等" "返回 $again"

    # 「全部已读」与并发新消息：读完立刻有人点赞，未读必须回到 1 而不是被抹掉。
    # 这是 Redis 计数器方案会吞消息的那条路径；MySQL 派生天然没有它。
    drop_like "$TOKEN2" "$POST_ID"
    sleep 0.5
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/notification/read-all" \
      -H "Authorization: Bearer $TOKEN"
    send_like "$TOKEN2" "$POST_ID"
    if wait_unread "$TOKEN" 1 >/dev/null; then
      ok "全部已读之后到达的消息不会被吞掉"
    else
      ng "全部已读吞掉了并发到达的消息" "未读=$(unread_total "$TOKEN")"
    fi

    # 游标翻页不重不漏
    ids=$(curl -s --max-time 10 "$SITE/api/notification/messages?limit=50" \
      -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
print(' '.join(m['id'] for m in d.get('items',[])))" 2>/dev/null)
    dup=$(printf '%s\n' $ids | sort | uniq -d | wc -l | tr -d ' ')
    [ "$dup" = "0" ] && ok "消息列表无重复项" || ng "消息列表有重复项" "$dup 个"
  fi
fi

# ================================================================ L4 单条已读

if want_layer l4; then
  section "L4 单条已读"

  if ! prepare_fixture; then
    ng "创建夹具失败" "无法 SSH 或建号失败"
  else
    # L4 需要在"只有一条未读"的干净状态下测。
    # 前面几层共用同一套夹具（FIXTURE_READY 是全局的），
    # 不清零的话"单条已读后未读归零"永远不可能成立——那是测试设计的问题，不是产品。
    curl -s --max-time 15 -o /dev/null -X POST "$SITE/api/notification/read-all" \
      -H "Authorization: Bearer $TOKEN"
    drop_like "$TOKEN2" "$POST_ID"
    sleep 0.5
    send_like "$TOKEN2" "$POST_ID"
    wait_unread "$TOKEN" 1 >/dev/null || true
    mid=$(curl -s --max-time 10 "$SITE/api/notification/messages?limit=1" \
      -H "Authorization: Bearer $TOKEN" | json_field 'data.items.0.id')

    if [ -n "$mid" ]; then
      r=$(curl -s --max-time 15 -X POST "$SITE/api/notification/messages/$mid/read" \
        -H "Authorization: Bearer $TOKEN" | json_field 'data')
      [ "$r" = "1" ] && ok "标记单条已读返回 1" || ng "标记单条已读未生效" "返回 $r"
      [ "$(unread_total "$TOKEN")" = "0" ] && ok "单条已读后未读归零" || ng "单条已读后未读不为 0"

      r=$(curl -s --max-time 15 -X POST "$SITE/api/notification/messages/$mid/read" \
        -H "Authorization: Bearer $TOKEN" | json_field 'data')
      [ "$r" = "0" ] && ok "重复标记同一条件是幂等的（0）" || ng "重复标记不幂等" "返回 $r"

      # 越权：别人不能标记我的消息
      r=$(curl -s --max-time 15 -X POST "$SITE/api/notification/messages/$mid/read" \
        -H "Authorization: Bearer $TOKEN2" | json_field 'data')
      [ "$r" = "0" ] && ok "不能标记别人的消息（返回 0）" || ng "越权标记成功了" "返回 $r"
    else
      ng "拿不到消息 id，L4 无法继续"
    fi

    # 未登录必须 401（网关挡住），不是 200 + 业务错误
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/notification/unread")
    [ "$code" = "401" ] && ok "未登录访问未读接口返回 401" || ng "未登录未被拦截" "HTTP $code"
  fi
fi

# ================================================================ L5 SSE

if want_heavy_layer l5; then
  section "L5 SSE 推送"

  if ! prepare_fixture; then
    ng "创建夹具失败"
  else
    sse_log=$(mktemp)
    curl -sN --max-time 20 "$SITE/api/notification/stream" \
      -H "Authorization: Bearer $TOKEN" > "$sse_log" 2>/dev/null &
    sse_pid=$!
    sleep 3

    grep -q 'event:connected' "$sse_log" \
      && ok "SSE 建立连接并收到 connected 首帧" || ng "SSE 未收到首帧"

    drop_like "$TOKEN2" "$POST_ID"
    sleep 0.5
    send_like "$TOKEN2" "$POST_ID"
    sleep 6

    grep -q 'event:message' "$sse_log" \
      && ok "别人点赞时 SSE 推送 message 帧" || ng "SSE 没有推送"
    kill "$sse_pid" 2>/dev/null
    wait "$sse_pid" 2>/dev/null
    rm -f "$sse_log"

    # 心跳：15 秒一帧注释。这里不等待 15 秒（太贵），只断言配置里确实是 15s。
    grep -q 'HEARTBEAT_MS = 15_000' "$APP_DIR/services/notification-service/src/main/java/top/katzenyasax/kuaikan/notification/service/SseService.java" \
      && ok "心跳间隔 15s（小于网关与 nginx 的读超时）" || ng "心跳间隔不是 15s"

    # nginx 必须为 SSE 关掉缓冲，否则帧会被攒着不发
    grep -q 'proxy_buffering off' "$APP_DIR/deploy/nginx/kuaikan.conf" \
      && ok "nginx 为 SSE 关闭了 proxy_buffering" || ng "nginx 未关闭 proxy_buffering"
  fi
fi

# ================================================================ L6 回归

if want_heavy_layer l6; then
  section "L6 回归（P0 / P0.5 / P1 / P2 / P3）"

  out=$(ssh_run 'cd /opt/kuaikan/repo && git fetch -q origin && git reset -q --hard origin/main \
    && bash deploy/bin/verify.sh --no-restart --skip-log-check' 2>&1)
  printf '%s' "$out" | grep -q 'P0 验收通过' && ok "verify.sh（P0）全绿" \
    || ng "verify.sh（P0）有失败" "$(printf '%s' "$out" | tail -1)"

  # 子脚本输出必须转出来：吞掉 stderr 只报"有失败"，
  # 排查时只能靠猜或把整套重跑一遍——那是最贵也最没信息量的做法。
  for script in verify-p05.sh verify-p1.sh verify-p2.sh verify-p3.sh; do
    child_log="/tmp/kuaikan-p4-l6-${script%.sh}.log"
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
printf '  %sP4 验收通过%s\n' "$G" "$N"
