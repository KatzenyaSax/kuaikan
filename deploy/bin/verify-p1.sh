#!/usr/bin/env bash
# P1 验收：一条命令覆盖前后端两侧。退出码 0 即 P1 完成。
#
#   ./deploy/bin/verify-p1.sh            正式验收
#   ./deploy/bin/verify-p1.sh --fast     跳过浏览器层与破坏性动作
#
# 分层：
#   L1 契约与构建   check-contract / gen:types 无漂移 / typecheck / build
#   L2 后端 HTTP    身份、凭据、cookie、信任边界、失效语义（经公网网关）
#   L3 浏览器       9 条只有浏览器能验的行为（playwright）
#   L4 破坏性动作   kick / ban / unban（经 SSH 调 /internal/admin，公网不可达）
#   L5 回归         verify.sh（P0）+ verify-p05.sh（P0.5）
#
# 测试数据：每次运行创建一个 @kuaikan.test 的临时账号，结束时删除（含 refresh 行与 Redis 键）。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"

FAST=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
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

# ---------------------------------------------------------------- 测试夹具
# 密码 E2eFixture-Passw0rd 的 BCrypt 哈希（cost 10，与线上一致）。
# 这是**测试夹具**不是密钥：哈希对应该固定测试密码，账号每次运行都不同且结束即删。
FIXTURE_HASH='$2a$10$5SZSC3aIXFj9q3PyX1f3FuxLrHv4bcoXpYgRNFPj.ayJ8fUhrKBy2'
FIXTURE_PASS='E2eFixture-Passw0rd'
STAMP="$(date +%s)"
EMAIL="e2e+p1${STAMP}@kuaikan.test"
NICKNAME="e2e-${STAMP}"
USER_ID=""

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-15}" "$1" 2>/dev/null || echo "000"; }
http_body() { curl -s --max-time "${2:-15}" "$1" 2>/dev/null; }
json_field() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit(0)
v=d
for k in sys.argv[1].split('.'):
    if isinstance(v,dict) and k in v: v=v[k]
    else: print(''); raise SystemExit(0)
print('' if v is None else v)
" "$1" 2>/dev/null; }

ssh_run() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@" 2>/dev/null; }

cleanup() {
  if [ -n "$USER_ID" ]; then
    ssh_run "set -a; . $ENV_FILE; set +a;
      docker exec kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -e \"
        DELETE FROM kuaikan_user.t_refresh_token WHERE user_id=$USER_ID;
        DELETE FROM kuaikan_user.t_user WHERE id=$USER_ID;\" >/dev/null 2>&1 || true
      docker exec -e P=\"\$REDIS_PASSWORD\" kuaikan-redis-1 sh -c '
        for k in \$(redis-cli --no-auth-warning -a \"\$P\" --scan --pattern \"auth:*\"); do
          redis-cli --no-auth-warning -a \"\$P\" del \"\$k\" >/dev/null
        done' >/dev/null 2>&1 || true" >/dev/null 2>&1
    info "已清理测试账号 $EMAIL"
  fi
}
trap cleanup EXIT

printf '%s%s%s\n' "$B" "kuaikan · P1 验收" "$N"
info "站点 $SITE"
info "开始 $(date '+%F %T')"

# ---------------------------------------------------------------- L1 契约与构建
section "L1 契约与构建"
if command -v node >/dev/null 2>&1; then
  if node "$APP_DIR/deploy/bin/check-contract.mjs" >/tmp/p1-contract.log 2>&1; then
    ok "错误码契约三方一致"
  else
    ng "错误码契约" "见 /tmp/p1-contract.log"
  fi
  if (cd "$WEB_DIR" && npm run gen:types >/tmp/p1-gen.log 2>&1); then
    dirty=$(git -C "$APP_DIR" status --porcelain web/openapi web/src/shared/api/types)
    [ -z "$dirty" ] && ok "spec 与生成的类型无漂移" || ng "契约漂移" "先提交生成物"
  else
    ng "gen:types 失败" "见 /tmp/p1-gen.log"
  fi
  (cd "$WEB_DIR" && npm run typecheck >/tmp/p1-tc.log 2>&1) \
    && ok "typecheck 0 error" || ng "typecheck" "见 /tmp/p1-tc.log"
  (cd "$WEB_DIR" && npm run build >/tmp/p1-build.log 2>&1) \
    && ok "build 成功" || ng "build" "见 /tmp/p1-build.log"
else
  skip "L1 契约与构建" "本机无 node"
fi

# ---------------------------------------------------------------- 建测试账号
section "准备：创建临时测试账号"
ssh_ok=0
ssh_run 'true' && ssh_ok=1
if [ $ssh_ok = 1 ]; then
  # SQL 用 base64 传过去：BCrypt 哈希里全是 $，直接内插进远端双引号命令
  # 会被远端 shell 当成变量展开（$2a / $10 ...），哈希就被打坏了。
  SQL=$(printf '%s' "INSERT INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status)
      VALUES (FLOOR(RAND()*900000000000000000)+100000000000000000, '$EMAIL', '$FIXTURE_HASH', '$NICKNAME', 'USER', 1);
      SELECT id FROM kuaikan_user.t_user WHERE email='$EMAIL';" | base64 | tr -d '\n')
  out=$(ssh_run "echo '$SQL' | base64 -d > /tmp/p1-fixture.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/p1-fixture.sql 2>/dev/null | tail -1
    rm -f /tmp/p1-fixture.sql")
  USER_ID=$(printf '%s' "$out" | tr -d '\r\n ')
  if [ -n "$USER_ID" ]; then
    ok "测试账号已创建 userId=$USER_ID"
  else
    ng "创建测试账号失败"
  fi
else
  ng "无法 SSH 到 $SSH_HOST" "P1 验收需要服务器权限（建账号、kick/ban、清理）"
fi

# ---------------------------------------------------------------- L2 后端 HTTP
section "L2 后端 HTTP"
if [ -z "$USER_ID" ]; then
  skip "L2 后端 HTTP" "没有测试账号"
else
  # 注册开关必须关闭（这是产品约定，也是 P1.1 的验收点）
  reg=$(curl -s -o /tmp/p1-reg.json -w '%{http_code}' -X POST "$SITE/api/user/auth/register/code" \
    -H 'Content-Type: application/json' -d "{\"email\":\"probe$STAMP@kuaikan.test\"}")
  if [ "$reg" = "403" ] && grep -q '"code":40203' /tmp/p1-reg.json; then
    ok "注册开关关闭（403 / 40203）"
  else
    ng "注册开关状态异常" "HTTP $reg"
  fi

  bad_pwd=$(curl -s -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}")
  ok_user=$(curl -s -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"nobody@kuaikan.test","password":"wrong-password"}')
  if printf '%s' "$bad_pwd" | grep -q '"code":40206' && [ "$bad_pwd" = "$ok_user" ]; then
    ok "凭据错误 = 200/40206，且与'邮箱不存在'完全一致（防枚举）"
  else
    ng "登录失败语义" "密码错=$bad_pwd / 邮箱不存在=$ok_user"
  fi

  rm -f /tmp/p1-jar.txt
  curl -s -D /tmp/p1-h.txt -c /tmp/p1-jar.txt -o /tmp/p1-login.json \
    -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}"
  TOKEN=$(json_field 'data.accessToken' < /tmp/p1-login.json)
  MYID=$(json_field 'data.user.userId' < /tmp/p1-login.json)

  cookie=$(grep -i '^set-cookie:' /tmp/p1-h.txt | tr -d '\r')
  missing=""
  for a in HttpOnly Secure 'SameSite=Lax' 'Path=/api/user/auth' 'Max-Age=2592000'; do
    printf '%s' "$cookie" | grep -qi -- "$a" || missing="$missing $a"
  done
  [ -z "$missing" ] && ok "refresh cookie 属性齐全" || ng "cookie 属性缺失" "$missing"

  if [ -n "$TOKEN" ]; then
    ok "登录成功并拿到 accessToken"
  else
    # 没有 token 的话，下面"应该 401"的断言都会空转通过，必须拦住
    ng "登录失败（后续断言无效）" "$(head -c 120 /tmp/p1-login.json)"
  fi

  code=$(http_code "$SITE/api/user/auth/me")
  [ "$code" = "401" ] && ok "/auth/me 无 token → 401" || ng "/auth/me 无 token" "HTTP $code"

  got=$(curl -s -H "Authorization: Bearer $TOKEN" "$SITE/api/user/auth/me" | json_field 'data.userId')
  [ "$got" = "$MYID" ] && ok "/auth/me 带 token → 自己的身份" || ng "/auth/me" "got=$got"

  forged=$(curl -s -H "Authorization: Bearer $TOKEN" -H "X-User-Id: 999" -H "X-User-Roles: PLATFORM_ADMIN" \
    "$SITE/api/user/auth/me" | json_field 'data.userId')
  [ "$forged" = "$MYID" ] && ok "伪造 X-User-Id 被剥离（返回自己的 id）" \
    || ng "伪造头生效（严重）" "got=$forged"

  tampered=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN%?}X" "$SITE/api/user/auth/me")
  [ "$tampered" = "401" ] && ok "篡改签名 → 401" || ng "篡改签名未被拒" "HTTP $tampered"

  rt=$(grep kuaikan_refresh /tmp/p1-jar.txt | awk '{print $7}')
  used_as_access=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $rt" "$SITE/api/user/auth/me")
  [ "$used_as_access" = "401" ] && ok "refresh 当 access 用 → 401（typ 校验）" \
    || ng "refresh 可当 access 用（严重）" "HTTP $used_as_access"

  who=$(curl -s -H "Authorization: Bearer $TOKEN" "$SITE/api/community/whoami" | json_field 'data.userId')
  [ "$who" = "$MYID" ] && ok "网关注入 → community-service 读到的就是本人" \
    || ng "网关注入未生效" "community 读到 '$who'"

  # 续期轮换
  curl -s -b /tmp/p1-jar.txt -c /tmp/p1-jar.txt -o /tmp/p1-refresh.json -X POST "$SITE/api/user/auth/refresh"
  new_rt=$(grep kuaikan_refresh /tmp/p1-jar.txt | awk '{print $7}')
  [ -n "$new_rt" ] && [ "$new_rt" != "$rt" ] && ok "refresh 轮换（旧值已换新）" \
    || ng "refresh 未轮换"
  grace=$(curl -s -o /dev/null -w '%{http_code}' -b "kuaikan_refresh=$rt" -X POST "$SITE/api/user/auth/refresh")
  [ "$grace" = "200" ] && ok "宽限期内同一 refresh 可重复使用（多标签页不误杀）" \
    || ng "宽限期失效" "HTTP $grace"

  # 登出
  curl -s -b /tmp/p1-jar.txt -H "Authorization: Bearer $TOKEN" -o /dev/null -X POST "$SITE/api/user/auth/logout"
  after=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$SITE/api/user/auth/me")
  [ "$after" = "401" ] && ok "登出后 access 立刻失效" || ng "登出未即时生效" "HTTP $after"
fi

# ---------------------------------------------------------------- L3 浏览器
section "L3 浏览器（playwright）"
if [ $FAST = 1 ]; then
  skip "浏览器层" "--fast"
elif [ -z "$USER_ID" ]; then
  skip "浏览器层" "没有测试账号"
elif ! command -v node >/dev/null 2>&1; then
  skip "浏览器层" "本机无 node"
else
  if (cd "$WEB_DIR" && E2E_EMAIL="$EMAIL" E2E_PASSWORD="$FIXTURE_PASS" \
      npm run e2e:auth >/tmp/p1-e2e.log 2>&1); then
    n=$(grep -c '✓' /tmp/p1-e2e.log)
    ok "浏览器验收通过（$n 项：守卫/登录/静默续期/不闪登录页/存储无 token/登出）"
  else
    ng "浏览器验收失败" "见 /tmp/p1-e2e.log"
    grep '✗' /tmp/p1-e2e.log | sed 's/^/      /' | head -5
  fi
fi

# ---------------------------------------------------------------- L4 破坏性动作
section "L4 破坏性动作（kick / ban / unban，经 SSH）"
if [ $FAST = 1 ]; then
  skip "kick / ban / unban" "--fast"
elif [ -z "$USER_ID" ] || [ $ssh_ok != 1 ]; then
  skip "kick / ban / unban" "缺账号或 SSH"
else
  admin() {
    ssh_run "docker exec kuaikan-user-service-1 curl -s -X POST http://127.0.0.1:8081/internal/admin/$1 \
      -H 'Content-Type: application/json' -d '$2'"
  }

  # kick：先登录拿一对新凭证
  rm -f /tmp/p1-jar2.txt
  curl -s -c /tmp/p1-jar2.txt -o /tmp/p1-login2.json -X POST "$SITE/api/user/auth/login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}"
  t2=$(json_field 'data.accessToken' < /tmp/p1-login2.json)
  if [ -z "$t2" ]; then
    # 没有 token 时，后面所有"应该 401"的断言都会空转通过 —— 必须显式拦住
    ng "kick 段无法登录，断言无效" "$(head -c 100 /tmp/p1-login2.json)"
  fi

  admin kick "{\"userId\":\"$USER_ID\"}" >/dev/null
  sleep 1
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $t2" "$SITE/api/user/auth/me")
  [ "$c" = "401" ] && ok "kick 后 access 立刻失效（401）" || ng "kick 未生效" "HTTP $c"
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SITE/api/user/auth/login" \
      -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}")
  [ "$c" = "200" ] && ok "kick 不改账号状态（仍可重新登录）" || ng "kick 后无法登录" "HTTP $c"

  # ban
  rm -f /tmp/p1-jar3.txt
  curl -s -c /tmp/p1-jar3.txt -o /tmp/p1-login3.json -X POST "$SITE/api/user/auth/login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}"
  t3=$(json_field 'data.accessToken' < /tmp/p1-login3.json)
  if [ -z "$t3" ]; then
    ng "ban 段无法登录，断言无效" "$(head -c 100 /tmp/p1-login3.json)"
  fi
  admin ban "{\"userId\":\"$USER_ID\",\"reason\":\"P1 验收\"}" >/dev/null
  sleep 1

  c=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $t3" "$SITE/api/user/auth/me")
  [ "$c" = "401" ] && ok "ban 后已签发 access 立刻失效" || ng "ban 后 access 仍有效" "HTTP $c"

  body=$(curl -s -X POST "$SITE/api/user/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}")
  printf '%s' "$body" | grep -q '"code":40205' && ok "ban 后登录 → 40205 账号已被封禁" \
    || ng "ban 后登录未被拒" "$(printf '%s' "$body" | head -c 100)"

  c=$(http_code "$SITE/api/user/ping")
  [ "$c" = "200" ] && ok "ban 后游客可读接口仍 200（降级为游客）" || ng "ban 影响游客读" "HTTP $c"

  admin unban "{\"userId\":\"$USER_ID\"}" >/dev/null
  sleep 1
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SITE/api/user/auth/login" \
      -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASS\"}")
  [ "$c" = "200" ] && ok "unban 后恢复登录" || ng "unban 未恢复" "HTTP $c"
fi

# ---------------------------------------------------------------- L5 回归
section "L5 回归（P0 / P0.5）"
if [ $ssh_ok = 1 ]; then
  out=$(ssh_run 'cd /opt/kuaikan/repo && git fetch -q origin && git reset -q --hard origin/main && bash deploy/bin/verify.sh --no-restart' 2>&1)
  printf '%s' "$out" | grep -q 'P0 验收通过' && ok "P0 验收全绿" \
    || { ng "P0 验收未通过"; printf '%s' "$out" | tail -8 | sed 's/^/      /'; }
else
  skip "P0 回归" "无法 SSH"
fi
if command -v node >/dev/null 2>&1; then
  out=$(bash "$APP_DIR/deploy/bin/verify-p05.sh" --fast 2>&1)
  printf '%s' "$out" | grep -q 'P0.5 验收通过' && ok "P0.5 验收全绿" \
    || { ng "P0.5 验收未通过"; printf '%s' "$out" | tail -8 | sed 's/^/      /'; }
else
  skip "P0.5 回归" "本机无 node"
fi

# ---------------------------------------------------------------- 汇总
section "汇总"
printf '  %s通过 %d%s   %s失败 %d%s   %s跳过 %d%s\n' "$G" "$PASS" "$N" "$R" "$FAIL" "$N" "$Y" "$SKIP" "$N"

cat <<'EOF'

  人工清单（无法脚本化）：
    1. 被踢下线后，页面应提示「登录状态已过期」，而不是静默跳登录页
    2. 被封禁后，页面应提示「账号已被封禁，如有疑问请联系管理员」
    3. 首页与 /test 在视觉上正常（白底黑字）

EOF

if [ "$FAIL" -gt 0 ]; then
  printf '  %s未通过：%s\n' "$R" "$N"
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  printf '\n  %sP1 未完成%s\n' "$R" "$N"
  exit 1
fi
printf '  %sP1 验收通过%s\n\n' "$G" "$N"
exit 0
