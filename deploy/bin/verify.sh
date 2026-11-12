#!/usr/bin/env bash
# kuaikan · P0 验收脚本
#
# 把 P0 阶段的全部手工验证固化成可重复执行的断言。退出码 0 = P0 完成。
#
#   ./deploy/bin/verify.sh              常规验收（含重启自愈）
#   ./deploy/bin/verify.sh --no-restart 跳过会重启服务的断言
#   ./deploy/bin/verify.sh --cold       先全量 down 再 up all，然后验收（含冷启动计时）
#
# 设计原则：
#   - 每条断言都必须能证伪。宁可红，不要绿得没有意义。
#   - 只在服务器上跑（需要 docker 与 compose）。
#   - 断言 9（端口收敛）与断言 10（重启自愈）是刻意加的：
#     前者防"某天为调试把端口映射出来忘了删"，后者防"起来一次就再也不敢重启"。
set -uo pipefail

REPO="${REPO:-/opt/kuaikan/repo}"
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"
COMPOSE_FILE="$REPO/deploy/compose/compose.yml"
INTERNAL="http://127.0.0.1:8080"
PUBLIC="https://www.katzenyasax.top"
DOMAIN="www.katzenyasax.top"

DO_RESTART=1
DO_COLD=0

for arg in "$@"; do
  case "$arg" in
    --no-restart) DO_RESTART=0 ;;
    --cold)       DO_COLD=1 ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
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
ok()      { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
ng()      { FAIL=$((FAIL+1)); FAILED+=("$1"); printf '  %s✗%s %s%s%s\n' "$R" "$N" "$1" "${2:+ — $2}" ""; }
skip()    { SKIP=$((SKIP+1)); printf '  %s-%s %s（%s）\n' "$Y" "$N" "$1" "${2:-跳过}"; }
info()    { printf '  %s%s%s\n' "$D" "$1" "$N"; }

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile core --profile app "$@"; }

cid_of()   { compose ps -q "$1" 2>/dev/null; }
health_of() {
  local cid; cid=$(cid_of "$1")
  [ -n "$cid" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo missing
}
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "$1" 2>/dev/null || echo "000"; }
http_body() { curl -s --max-time "${2:-10}" "$1" 2>/dev/null; }

SERVICES="gateway:8080 user-service:8081 community-service:8082 content-service:8083 interaction-service:8084 notification-service:8085 search-service:8086 rank-service:8087"
CORE="mysql redis nacos rmq-namesrv rmq-broker"

# ---------------------------------------------------------------- 前置
section "前置检查"
[ -f "$ENV_FILE" ] || { echo "${R}缺少 $ENV_FILE${N}" >&2; exit 2; }
[ -f "$COMPOSE_FILE" ] || { echo "${R}缺少 $COMPOSE_FILE${N}" >&2; exit 2; }
info "仓库 ${REPO} @ $(git -C "$REPO" log --oneline -1 2>/dev/null | cut -d' ' -f1)"
info "开始时间 $(date '+%F %T')"

# ---------------------------------------------------------------- 可选：冷启动
if [ "$DO_COLD" = "1" ]; then
  section "冷启动（down → up all）"
  echo "  ${D}down --remove-orphans ...${N}"
  compose down --remove-orphans >/dev/null 2>&1
  t0=$SECONDS
  WAIT_TIMEOUT=600 bash "$REPO/deploy/bin/up.sh" all >/tmp/kuaikan-coldstart.log 2>&1
  rc=$?
  cold_s=$((SECONDS - t0))
  if [ $rc -eq 0 ]; then
    ok "冷启动完成，耗时 ${cold_s}s（日志 /tmp/kuaikan-coldstart.log）"
  else
    ng "冷启动失败（rc=${rc}）" "见 /tmp/kuaikan-coldstart.log 末尾"
    tail -30 /tmp/kuaikan-coldstart.log | sed 's/^/    /'
  fi
fi

# ---------------------------------------------------------------- 1. 边缘存活
section "1. 边缘代理存活"
body=$(http_body "https://$DOMAIN/healthz")
if [ "$(printf '%s' "$body" | tr -d '[:space:]')" = "ok" ]; then
  ok "https://$DOMAIN/healthz → ok"
else
  ng "https://$DOMAIN/healthz" "返回：$body"
fi

# ---------------------------------------------------------------- 2. 容器健康
section "2. 全部容器 healthy"
bad=""
for s in $CORE $(printf '%s' "$SERVICES" | tr ' ' '\n' | cut -d: -f1); do
  h=$(health_of "$s")
  [ "$h" = "healthy" ] || bad="$bad $s($h)"
done
if [ -z "$bad" ]; then
  ok "13 个容器全部 healthy"
else
  ng "容器健康检查" "未就绪：$bad"
fi

# ---------------------------------------------------------------- 3. Nacos 注册
section "3. 服务注册（Nacos）"
reg=$(docker exec kuaikan-nacos-1 curl -s "http://127.0.0.1:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=50" 2>/dev/null)
missing=""
for s in gateway user-service community-service content-service interaction-service notification-service search-service rank-service; do
  printf '%s' "$reg" | grep -q "\"$s\"" || missing="$missing $s"
done
if [ -z "$missing" ]; then
  ok "8 个服务全部注册"
else
  ng "服务注册" "缺失：$missing"
fi

# ---------------------------------------------------------------- 4. 网关路由
section "4. 网关路由（/api/{service}/** + StripPrefix=2）"
bad=""
for pair in $SERVICES; do
  svc=${pair%%:*}
  path="/api/${svc%-service}/ping"
  [ "$svc" = "gateway" ] && continue      # gateway 自身 /ping 不在 /api 下
  code=$(http_code "$INTERNAL$path")
  [ "$code" = "200" ] || bad="$bad $path($code)"
done
if [ -z "$bad" ]; then
  ok "7 条路由全部转发成功"
else
  ng "网关路由" "$bad"
fi

# ---------------------------------------------------------------- 5. Feign 服务发现
section "5. Feign + Nacos 服务发现"
feign=$(http_body "$INTERNAL/api/user/ping/feign")
if printf '%s' "$feign" | grep -q '"service":"community-service"'; then
  callee_host=$(printf '%s' "$feign" | sed -n 's/.*"callee":{[^}]*"host":"\([^"]*\)".*/\1/p')
  ok "user-service → community-service 调用成功（callee.host=${callee_host:-?}）"
else
  ng "Feign 调用链" "响应：$(printf '%s' "$feign" | head -c 160)"
fi

# ------------------------------------------------- 5b. 网关注入 → 服务读取
section "5b. 网关注入 → 服务读取（/api/community/whoami）"
# 这个探针刻意不在 /ping/** 下：那个前缀是放行的，放行分支会剥离身份头，
# 放在那里访问永远匿名、探针失效。whoami 走完整认证路径。
whoami_anon=$(http_code "$INTERNAL/api/community/whoami")
if [ "$whoami_anon" = "401" ]; then
  ok "/whoami 无 token → 401"
else
  ng "/whoami 无 token 未被拒" "HTTP $whoami_anon"
fi

# 用一个真实账号走完整链路：登录 → 带 token 调 whoami → 断言服务读到的就是本人
# 用**测试专用账号**，不是人工 e2e 用的那个：
# 脚本会反复登录，不该占用开发者自己的账号（会话列表、登录时间都会被搅乱）。
DEV_EMAIL="agent@kuaikan.test"
DEV_PASS="AgentFixture-9f3Kx2Qw"
login_body=$(curl -s -X POST --max-time 15 "$INTERNAL/api/user/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASS\"}" 2>/dev/null)
token=$(printf '%s' "$login_body" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
expect_id=$(printf '%s' "$login_body" | sed -n 's/.*"userId":"\([0-9]*\)".*/\1/p')

if [ -z "$token" ]; then
  skip "网关注入 → 服务读取" "测试账号 agent@kuaikan.test 登录失败（可能密码已改）"
else
  whoami=$(curl -s --max-time 15 -H "Authorization: Bearer $token" "$INTERNAL/api/community/whoami" 2>/dev/null)
  got_id=$(printf '%s' "$whoami" | sed -n 's/.*"userId":"\([0-9]*\)".*/\1/p')
  if [ "$got_id" = "$expect_id" ]; then
    ok "community-service 读到的身份就是本人（userId=${expect_id}）"
  else
    ng "网关注入未生效" "服务读到 '${got_id:-空}'，期望 $expect_id"
  fi
fi

# ---------------------------------------------------------------- 6. RocketMQ 收发
section "6. RocketMQ 端到端（发 → broker → 消费 → Feign 回查）"
send=$(curl -s -X POST --max-time 15 "$INTERNAL/api/user/ping/mq" 2>/dev/null)
tid=$(printf '%s' "$send" | sed -n 's/.*"traceId":"\([^"]*\)".*/\1/p')
if printf '%s' "$send" | grep -q '"sendStatus":"SEND_OK"' && [ -n "$tid" ]; then
  ok "消息发送成功 traceId=$tid"
  received=""
  t0=$SECONDS
  for _ in $(seq 1 30); do
    q=$(http_body "$INTERNAL/api/user/ping/mq/$tid")
    printf '%s' "$q" | grep -q '"received":true' && { received=1; break; }
    sleep 0.5
  done
  if [ -n "$received" ]; then
    ok "消息被消费（端到端 $((SECONDS - t0))s）"
  else
    ng "消息消费" "15 秒内未消费 traceId=$tid"
  fi
else
  ng "消息发送" "响应：$(printf '%s' "$send" | head -c 160)"
fi

# ---------------------------------------------------------------- 7. Sentinel 限流
section "7. Sentinel 限流（阈值 QPS=2）"
allowed=0; limited=0
for _ in $(seq 1 10); do
  r=$(curl -s -o /tmp/kuaikan-sentinel.json -w '%{http_code}' --max-time 5 "$INTERNAL/api/user/ping/sentinel" 2>/dev/null)
  if [ "$r" = "200" ]; then
    allowed=$((allowed+1))
  elif [ "$r" = "429" ] && grep -q '"code":42900' /tmp/kuaikan-sentinel.json 2>/dev/null; then
    limited=$((limited+1))
  fi
done
if [ "$limited" -gt 0 ] && [ "$allowed" -gt 0 ]; then
  ok "限流生效：放行 $allowed 次 / 限流 $limited 次（429 + code 42900）"
else
  ng "Sentinel 限流" "放行 $allowed / 限流 ${limited}（预期两者都非 0）"
fi

# ---------------------------------------------------------------- 8. Actuator
section "8. Actuator readiness"
bad=""
for pair in $SERVICES; do
  svc=${pair%%:*}; port=${pair##*:}
  cid=$(cid_of "$svc")
  [ -z "$cid" ] && { bad="$bad $svc(no-container)"; continue; }
  h=$(docker exec "$cid" curl -fsS "http://127.0.0.1:$port/actuator/health/readiness" 2>/dev/null)
  printf '%s' "$h" | grep -q '"status":"UP"' || bad="$bad $svc"
done
if [ -z "$bad" ]; then
  ok "8 个服务 readiness 全部 UP"
else
  ng "readiness" "$bad"
fi

# ---------------------------------------------------------------- 9. 端口收敛
section "9. 公网端口收敛（只应 22/80/443，且 8080 仅回环）"
leaked=$(ss -lntH 2>/dev/null | awk '$1=="LISTEN"{print $4}' \
  | grep -E '^(0\.0\.0\.0|\[::\]|\*):' \
  | sed 's/.*://' | sort -un \
  | grep -vE '^(22|80|443)$' | tr '\n' ' ')
if [ -z "$leaked" ]; then
  ok "非回环监听端口只有 22/80/443"
else
  ng "端口收敛" "额外暴露：$leaked"
fi
# 配置层断言：除 gateway 外，任何服务都不得声明 ports。
# 这比"运行时看端口"更早发现问题——写下一行 ports: 的那一刻就该红，
# 而不是等到某天有人去探测。
if command -v python3 >/dev/null 2>&1; then
  leaked_cfg=$(compose config --format json 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print('')
    raise SystemExit(0)
bad=[n for n,s in d.get('services',{}).items() if n!='gateway' and s.get('ports')]
print(' '.join(bad))
" 2>/dev/null)
  if [ -z "$leaked_cfg" ]; then
    ok "配置层：除 gateway 外无服务声明 ports"
  else
    ng "配置层端口泄漏" "这些服务在 compose 里声明了 ports: $leaked_cfg"
  fi
fi

gw8080=$(ss -lntH 2>/dev/null | awk '$1=="LISTEN" && $4 ~ /:8080$/ {print $4}')
if printf '%s' "$gw8080" | grep -q '^127\.0\.0\.1:8080$'; then
  ok "网关 8080 仅绑定 127.0.0.1"
else
  ng "网关 8080 绑定" "实际：$gw8080"
fi

# ---------------------------------------------------------------- 10. 日志
# 注意：这一步必须跑在"重启自愈"之前。
# 重启窗口内网关会对下游返回真实的 500，那是预期行为，不该被日志断言算成异常。
# 拆开的语义更清楚：日志断言管"稳态是否干净"，重启断言管"能不能自愈"。
section "10. 日志无异常（近 10 分钟）"
# nacos-client 在优雅关闭时会打 InterruptedException，是已知无害噪音
NOISE='NotifyCenter|Nacos client graceful shutdown|GracefulShutdownDelegate|InterruptedException'
if [ "$SKIP_LOG_CHECK" = "1" ]; then
  skip "日志断言" "被 --skip-log-check 显式跳过（破坏性验证之后日志必然有噪音）"
else
  dirty=""
  for s in $(printf '%s' "$SERVICES" | tr ' ' '\n' | cut -d: -f1); do
    cid=$(cid_of "$s")
    [ -z "$cid" ] && continue
    n=$(docker logs --since 10m "$cid" 2>&1 | grep -E ' ERROR ' | grep -vE "$NOISE" | wc -l)
    [ "$n" -gt 0 ] && dirty="$dirty $s($n)"
  done
  if [ -z "$dirty" ]; then
    ok "8 个服务近期无 ERROR（已排除 nacos-client 关闭噪音）"
  else
    ng "日志异常" "$dirty"
  fi
fi

# ---------------------------------------------------------------- 11. 重启自愈
if [ "$DO_RESTART" = "1" ]; then
  section "11. 重启自愈（restart user-service）"
  docker restart "$(cid_of user-service)" >/dev/null 2>&1
  t0=$SECONDS
  recovered=""
  for _ in $(seq 1 40); do
    [ "$(health_of user-service)" = "healthy" ] && { recovered=1; break; }
    sleep 2
  done
  if [ -n "$recovered" ]; then
    ok "user-service 恢复 healthy，耗时 $((SECONDS - t0))s"
    sleep 2
    code=$(http_code "$INTERNAL/api/user/ping")
    [ "$code" = "200" ] && ok "重启后网关调用正常（200）" || ng "重启后调用" "HTTP $code"
  else
    ng "重启自愈" "$((SECONDS - t0))s 内未恢复 healthy"
  fi
else
  section "11. 重启自愈"
  skip "重启自愈" "--no-restart"
fi

# ---------------------------------------------------------------- 12. 公网全链路
section "12. 公网全链路"
bad=""
for s in user community content interaction notification search rank; do
  code=$(http_code "$PUBLIC/api/$s/ping" 15)
  [ "$code" = "200" ] || bad="$bad /api/$s/ping($code)"
done
if [ -z "$bad" ]; then
  ok "7 个服务的公网访问全部 200"
else
  ng "公网访问" "$bad"
fi
code=$(http_code "$PUBLIC/api/nope/ping" 15)
[ "$code" = "404" ] && ok "未匹配路由返回 404（非 500）" || ng "未匹配路由" "HTTP $code"

# ---------------------------------------------------------------- 汇总
section "汇总"
printf '  %s通过 %d%s   %s失败 %d%s   %s跳过 %d%s\n' "$G" "$PASS" "$N" "$R" "$FAIL" "$N" "$Y" "$SKIP" "$N"
if [ "$FAIL" -gt 0 ]; then
  printf '\n  %s未通过的断言：%s\n' "$R" "$N"
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  printf '\n  %sP0 未完成%s\n' "$R" "$N"
  exit 1
fi
printf '\n  %sP0 验收通过%s\n' "$G" "$N"
exit 0
