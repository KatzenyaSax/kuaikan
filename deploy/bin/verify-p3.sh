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

# ================================================================ L2 后端 HTTP

if want_layer l2; then
  section "L2 后端 HTTP"
  skip "评论 CRUD 与两级展示" "P3.1 未实现"
  skip "tombstone 行为" "P3.1 未实现"
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
