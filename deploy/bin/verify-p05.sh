#!/usr/bin/env bash
# P0.5 验收：9 层 E2E。退出码 0 即 P0.5 完成。
#
#   ./deploy/bin/verify-p05.sh           正式验收（含 L2 契约一致性检查）
#   ./deploy/bin/verify-p05.sh --fast    跳过 L2（不重新生成类型）
#
# 运行位置探测：
#   - 开发机（有 node）→ 跑全部 9 层
#   - 服务器（无 node）→ L1~L3 记为 SKIP 并说明原因，其余照跑
#
# 分层理由见 docs/design/p05-frontend.md。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

SITE="${SITE:-https://www.katzenyasax.top}"

FAST=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
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

HAS_NODE=0
command -v node >/dev/null 2>&1 && HAS_NODE=1

printf '%s%s%s\n' "$B" "kuaikan · P0.5 验收" "$N"
info "仓库 $APP_DIR @ $(git -C "$APP_DIR" log --oneline -1 2>/dev/null | cut -d' ' -f1)"
info "开始 $(date '+%F %T')"
info "node 可用：$([ $HAS_NODE = 1 ] && echo yes || echo no)"

# ---------------------------------------------------------------- L1
section "L1 静态质量（typecheck + build）"
if [ $HAS_NODE = 0 ]; then
  skip "L1 静态质量" "本机无 node，请在开发机上运行"
else
  if (cd "$WEB_DIR" && npm run typecheck >/tmp/p05-l1-tc.log 2>&1); then
    ok "npm run typecheck 0 error"
  else
    ng "npm run typecheck" "见 /tmp/p05-l1-tc.log"
  fi
  if (cd "$WEB_DIR" && npm run build >/tmp/p05-l1-build.log 2>&1); then
    size=$(du -h "$WEB_DIR"/dist/assets/*.js 2>/dev/null | cut -f1 | head -1)
    ok "npm run build 成功（js ${size:-?}）"
  else
    ng "npm run build" "见 /tmp/p05-l1-build.log"
  fi
  # dev-only 内容不得进入产物
  if grep -rq "__error-demo" "$WEB_DIR/dist" 2>/dev/null; then
    ng "生产产物含 __error-demo" "dev-only 分支未被摇掉"
  else
    ok "生产产物不含 __error-demo（dev-only 已摇掉）"
  fi
fi

# ---------------------------------------------------------------- L2
section "L2 契约一致性（gen:types 后 git diff 必须为空）"
if [ $HAS_NODE = 0 ]; then
  skip "L2 契约一致性" "本机无 node"
elif [ $FAST = 1 ]; then
  skip "L2 契约一致性" "--fast"
else
  if (cd "$WEB_DIR" && npm run gen:types >/tmp/p05-l2.log 2>&1); then
    dirty=$(git -C "$APP_DIR" status --porcelain web/openapi web/src/shared/api/types)
    if [ -z "$dirty" ]; then
      ok "7 份 spec 与生成的类型一致"
    else
      ng "契约漂移" "生成物与已提交内容不一致，先提交或重新 dump spec"
      printf '%s\n' "$dirty" | sed 's/^/      /'
    fi
  else
    ng "npm run gen:types" "见 /tmp/p05-l2.log"
  fi
fi

# ---------------------------------------------------------------- L3
section "L3 API 冒烟（Node 直连后端，用生成的类型）"
if [ $HAS_NODE = 0 ]; then
  skip "L3 API 冒烟" "本机无 node"
else
  if (cd "$WEB_DIR" && npm run smoke:api >/tmp/p05-l3.log 2>&1); then
    n=$(grep -c '✓' /tmp/p05-l3.log)
    ok "7 个服务 + 1 个 404 断言全过（$n 项）"
  else
    ng "npm run smoke:api" "见 /tmp/p05-l3.log"
    tail -5 /tmp/p05-l3.log | sed 's/^/      /'
  fi
fi

# ---------------------------------------------------------------- L4
section "L4 线上是 Vite 产物而非占位页"
html=$(curl -fsS --max-time 20 "$SITE/" 2>/dev/null || true)
if [ -z "$html" ]; then
  ng "首页不可达" "$SITE/"
else
  if printf '%s' "$html" | grep -q '前端尚未构建'; then
    ng "首页仍是占位页"
  elif printf '%s' "$html" | grep -q '<script type="module"'; then
    ok "首页是 Vite 构建产物（含 module script，不含占位文案）"
  else
    ng "首页缺少 module script"
  fi
fi

# ---------------------------------------------------------------- L5
section "L5 静态资源可达"
asset=$(printf '%s' "$html" | grep -o '/assets/[^"]*\.js' | head -1)
if [ -z "$asset" ]; then
  ng "从首页抽不出 /assets/*.js"
else
  meta=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 20 "$SITE$asset")
  code=${meta%% *}
  ctype=${meta#* }
  if [ "$code" = "200" ] && printf '%s' "$ctype" | grep -qi javascript; then
    ok "$asset -> 200（${ctype}）"
  else
    ng "静态资源" "$asset -> $code / $ctype"
  fi
fi

# ---------------------------------------------------------------- L6a
section "L6a SPA 回退（/whatever 返回 index.html）"
body=$(curl -s -w '\n%{http_code}' --max-time 20 "$SITE/whatever" 2>/dev/null || true)
code=$(printf '%s' "$body" | tail -1)
content=$(printf '%s' "$body" | sed '$d')
if [ "$code" = "200" ] && printf '%s' "$content" | grep -q '<div id="root">'; then
  ok "/whatever -> 200 且是 index.html（前端路由兜底生效）"
else
  ng "SPA 回退" "code=$code"
fi

# ---------------------------------------------------------------- L6b
section "L6b 浏览器确认（人工）"
skip "浏览器看 /whatever 是否显示 404 UI" "见下方人工清单"
skip "浏览器看首页 7 张卡片是否全绿" "见下方人工清单"

# ---------------------------------------------------------------- L7
section "L7 内部契约端点不泄漏"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/user/internal/api-docs")
if [ "$code" = "404" ]; then
  ok "/api/user/internal/api-docs -> 404（网关拒绝）"
else
  ng "内部端点泄漏" "返回 $code"
fi

# ---------------------------------------------------------------- L8
section "L8 P0 回归（服务器上 verify.sh）"
if ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'test -d /opt/kuaikan/repo' 2>/dev/null; then
  out=$(ssh "${SSH_OPTS[@]}" "$SSH_HOST" \
    'cd /opt/kuaikan/repo && bash deploy/bin/verify.sh --no-restart' 2>&1 || true)
  summary=$(printf '%s' "$out" | grep -E '通过 [0-9]+' | tail -1)
  if printf '%s' "$out" | grep -q 'P0 验收通过'; then
    ok "verify.sh 全绿${summary:+（${summary//[$'\t']/ }）}"
  else
    ng "verify.sh 未通过"
    printf '%s' "$out" | tail -12 | sed 's/^/      /'
  fi
else
  skip "L8 P0 回归" "无法 SSH 到 $SSH_HOST"
fi

# ---------------------------------------------------------------- L9
section "L9 工作区干净"
dirty=$(git -C "$APP_DIR" status --porcelain 2>/dev/null)
if [ -z "$dirty" ]; then
  ok "git status 为空"
else
  ng "工作区有未提交改动"
  printf '%s\n' "$dirty" | head -8 | sed 's/^/      /'
fi

# ---------------------------------------------------------------- 汇总
section "汇总"
printf '  %s通过 %d%s   %s失败 %d%s   %s跳过 %d%s\n' "$G" "$PASS" "$N" "$R" "$FAIL" "$N" "$Y" "$SKIP" "$N"

cat <<'EOF'

  人工清单（无法脚本化的两条）：
    1. 浏览器打开 https://www.katzenyasax.top/       → 7 张卡片全绿，显示不同 host
    2. 浏览器打开 https://www.katzenyasax.top/whatever → 404 页面，不是白屏

EOF

if [ "$FAIL" -gt 0 ]; then
  printf '  %s未通过：%s\n' "$R" "$N"
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  printf '\n  %sP0.5 未完成%s\n' "$R" "$N"
  exit 1
fi
printf '  %sP0.5 验收通过%s\n\n' "$G" "$N"
exit 0
