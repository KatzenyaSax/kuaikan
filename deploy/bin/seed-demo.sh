#!/usr/bin/env bash
# 写入示例数据：5 个用户、5 个社群、17 篇帖子、若干评论与互动。
#
#   ./deploy/bin/seed-demo.sh             写入（幂等：已存在则跳过）
#   ./deploy/bin/seed-demo.sh --clean     删掉全部示例数据
#
# 为什么要有这批数据：
#   产品冷启动时只有 1 个社群 2 篇帖子，界面看起来"空得没做完"，
#   没法判断排版密度、列表节奏、评论区层级是否成立。
#   这批数据是**为了让人能评估界面**，不是测试夹具
#   （e2e 夹具由 e2e 脚本自建自删，两者不要混）。
#
# 账号约定：全部是 demo+<key>@kuaikan.test，密码统一 DemoPassw0rd!
# 清理只需一条 LIKE 'demo+%'。
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WEB_DIR="$APP_DIR/web"

SITE="${SITE:-https://www.katzenyasax.top}"
SSH_HOST="${SSH_HOST:-root@206.237.30.147}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pi_cloud}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ENV_FILE="${ENV_FILE:-/opt/kuaikan/env/kuaikan.env}"

# 密码 DemoPassw0rd! 的 BCrypt 哈希（cost 10，与线上一致）
DEMO_HASH='$2y$10$kuh8dkOyt7plMfOUorCoQ.teQJWeba.hR0hbfWRCxMBxWi5ZSZJcO'
DEMO_PASS='DemoPassw0rd!'
DEMO_EMAILS="'demo+linjian@kuaikan.test','demo+xiaoman@kuaikan.test','demo+kevin@kuaikan.test','demo+acha@kuaikan.test','demo+laobai@kuaikan.test'"
DEMO_NICKS="'林间','小满','kevin','阿茶','老白'"
DEMO_COMMUNITIES="'前端周刊','Rust 中文','摄影与器材','厨房实验','TypeScript 中文'"

CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

sql() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh "${SSH_OPTS[@]}" "$SSH_HOST" "echo '$b64' | base64 -d > /tmp/seed-demo.sql
    set -a; . $ENV_FILE; set +a
    docker exec -i kuaikan-mysql-1 mysql --default-character-set=utf8mb4 \
      -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N < /tmp/seed-demo.sql 2>/dev/null
    rm -f /tmp/seed-demo.sql"
}

if [ "$CLEAN" = "1" ]; then
  echo "==> 删除示例数据"
  # 顺序：从叶子往根删。评论/帖子按社群圈定，互动按"目标已不存在"兜底清理。
  out=$(sql "USE kuaikan_content;
    DELETE c FROM t_comment c JOIN t_post p ON p.id = c.post_id
      JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name IN ($DEMO_COMMUNITIES);
    DELETE p FROM t_post p JOIN kuaikan_community.t_community co ON co.id = p.community_id
      WHERE co.name IN ($DEMO_COMMUNITIES);
    USE kuaikan_community;
    DELETE m FROM t_community_member m JOIN t_community c ON c.id = m.community_id
      WHERE c.name IN ($DEMO_COMMUNITIES);
    DELETE FROM t_community WHERE name IN ($DEMO_COMMUNITIES);
    DELETE FROM kuaikan_user.t_refresh_token
      WHERE user_id IN (SELECT id FROM kuaikan_user.t_user WHERE email LIKE 'demo+%');
    DELETE FROM kuaikan_user.t_user WHERE email LIKE 'demo+%';
    DELETE i FROM kuaikan_interaction.t_interaction i
      WHERE (i.target_type = 1 AND i.target_id NOT IN (SELECT id FROM kuaikan_content.t_post))
         OR (i.target_type = 2 AND i.target_id NOT IN (SELECT id FROM kuaikan_content.t_comment));
    SELECT 'cleaned';" 2>&1)
  case "$out" in
    *ERROR*) echo "清理失败：$out" >&2; exit 1 ;;
    *) echo "    已删除示例账号、社群、帖子、评论与互动" ;;
  esac
  exit 0
fi

echo "==> 1/4 创建 5 个示例账号（已存在则跳过）"
out=$(sql "
  INSERT IGNORE INTO kuaikan_user.t_user (id, email, password_hash, nickname, roles, status) VALUES
    (FLOOR(RAND()*900000000000000000)+100000000000000000, 'demo+linjian@kuaikan.test', '$DEMO_HASH', '林间',  'USER', 1),
    (FLOOR(RAND()*900000000000000000)+100000000000000000, 'demo+xiaoman@kuaikan.test', '$DEMO_HASH', '小满',  'USER', 1),
    (FLOOR(RAND()*900000000000000000)+100000000000000000, 'demo+kevin@kuaikan.test',   '$DEMO_HASH', 'kevin', 'USER', 1),
    (FLOOR(RAND()*900000000000000000)+100000000000000000, 'demo+acha@kuaikan.test',    '$DEMO_HASH', '阿茶',  'USER', 1),
    (FLOOR(RAND()*900000000000000000)+100000000000000000, 'demo+laobai@kuaikan.test',  '$DEMO_HASH', '老白',  'USER', 1);
  SELECT COUNT(*) FROM kuaikan_user.t_user WHERE email LIKE 'demo+%';" 2>&1)
case "$out" in
  *ERROR*) echo "建账号失败：$out" >&2; exit 1 ;;
  *) echo "    示例账号数：$(printf '%s' "$out" | tr -d '\r\n ')" ;;
esac

echo "==> 2/4 建社群、发帖、评论、点赞、收藏（走真实接口）"
cd "$WEB_DIR"
if ! SITE="$SITE" DEMO_PASSWORD="$DEMO_PASS" node scripts/seed-demo.mjs; then
  echo "写入失败" >&2
  exit 1
fi

echo
echo "==> 3/4 回填时间戳（让列表看起来像积累出来的，而不是一次性灌进去的）"
# 只动示例社群里的数据，不碰真实内容。
#   社群：40 天前 ~ 30 天前
#   帖子：按 id 顺序每篇往前推 7 小时，覆盖最近约 5 天
#   评论：落在自己帖子之后 35~125 分钟，保证"评论晚于发帖"
out=$(sql "USE kuaikan_community;
  UPDATE t_community SET created_at = NOW() - INTERVAL (30 + (id % 10)) DAY
    WHERE name IN ($DEMO_COMMUNITIES);
  USE kuaikan_content;
  UPDATE t_post p JOIN (
    SELECT pp.id, ROW_NUMBER() OVER (ORDER BY pp.id) rn
    FROM t_post pp JOIN kuaikan_community.t_community c ON c.id = pp.community_id
    WHERE c.name IN ($DEMO_COMMUNITIES)
  ) x ON x.id = p.id
  SET p.created_at = NOW() - INTERVAL (x.rn * 420) MINUTE
  WHERE p.community_id IN (SELECT id FROM kuaikan_community.t_community WHERE name IN ($DEMO_COMMUNITIES));
  UPDATE t_comment cm JOIN t_post p ON p.id = cm.post_id
  SET cm.created_at = p.created_at + INTERVAL (35 + (cm.id % 90)) MINUTE
  WHERE p.community_id IN (SELECT id FROM kuaikan_community.t_community WHERE name IN ($DEMO_COMMUNITIES));
  SELECT 'ok';" 2>&1)
case "$out" in
  *ERROR*) echo "回填失败：$out" >&2; exit 1 ;;
  *) echo "    时间戳已回填" ;;
esac

echo "==> 4/4 汇总"
sql "SELECT CONCAT('  社群 ', COUNT(*)) FROM kuaikan_community.t_community WHERE name IN ($DEMO_COMMUNITIES);
  SELECT CONCAT('  帖子 ', COUNT(*)) FROM kuaikan_content.t_post
    WHERE community_id IN (SELECT id FROM kuaikan_community.t_community WHERE name IN ($DEMO_COMMUNITIES));
  SELECT CONCAT('  评论 ', COUNT(*)) FROM kuaikan_content.t_comment
    WHERE post_id IN (SELECT id FROM kuaikan_content.t_post
      WHERE community_id IN (SELECT id FROM kuaikan_community.t_community WHERE name IN ($DEMO_COMMUNITIES)));" | sed 's/^/  /'

echo
echo "账号：demo+{linjian,xiaoman,kevin,acha,laobai}@kuaikan.test / $DEMO_PASS"
echo "清理：./deploy/bin/seed-demo.sh --clean"
