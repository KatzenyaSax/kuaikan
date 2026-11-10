#!/usr/bin/env bash
# 只编译、不建镜像。用于本地无编译器时的快速反馈（15~30 秒）。
#
#   用法：  ./deploy/bin/check.sh            全量编译（9 个模块）
#           ./deploy/bin/check.sh user-service  只编译某个模块及其依赖
#
# 说明：本地（arm64 macOS）没有 JDK 21 / Maven，编译统一在服务器上以容器完成。
#       Maven 依赖缓存在 docker volume 里，不要 docker volume rm 它，否则下次要重下约 1GB。
set -euo pipefail

REPO="${REPO:-/opt/kuaikan/repo}"
MODULE="${1:-}"
MVN_IMAGE="${MVN_IMAGE:-maven:3.9-eclipse-temurin-21}"
CACHE_VOL="${CACHE_VOL:-kuaikan-maven-repo}"

[ -f "$REPO/services/pom.xml" ] || { echo "找不到 $REPO/services/pom.xml" >&2; exit 1; }

docker volume create "$CACHE_VOL" >/dev/null

args=(-B -DskipTests package)
if [ -n "$MODULE" ]; then
  args=(-B -DskipTests -pl "$MODULE" -am package)
  echo "==> 编译模块：${MODULE}（含其依赖模块）"
else
  echo "==> 全量编译 9 个模块"
fi

start=$(date +%s)
docker run --rm \
  -v "$REPO":/src \
  -v "$CACHE_VOL":/root/.m2 \
  -w /src/services \
  "$MVN_IMAGE" \
  mvn "${args[@]}"
end=$(date +%s)

echo
echo "==> 编译通过，耗时 $((end - start))s"
echo "==> 产物："
find "$REPO/services" -path '*/target/*.jar' -not -name '*sources*' -not -name '*original*' \
  -newermt "-10 minutes" -exec ls -lh {} \; 2>/dev/null | awk '{print "    " $5 "\t" $9}' || true
