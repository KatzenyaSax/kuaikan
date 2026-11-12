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

# ================================================================ L2 后端 HTTP
# P2.1~P2.4 逐刀往这里加。当前为空。

if want_layer l2; then
  section "L2 后端 HTTP"
  skip "社群 CRUD" "P2.1 未实现"
  skip "成员加入/退出与 member_count" "P2.2 未实现"
  skip "发帖与权限边界（41004）" "P2.3 未实现"
  skip "游标分页不重不漏" "P2.4 未实现"
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
  for script in verify.sh verify-p05.sh verify-p1.sh; do
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
