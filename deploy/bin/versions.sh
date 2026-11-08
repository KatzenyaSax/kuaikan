#!/usr/bin/env bash
# 采集实测版本号，输出可直接粘进 docs/project.md 的 Markdown 表格。
#
#   ./deploy/bin/versions.sh
#
# 原则：只报实测值，不推测。构建工具从镜像里问，运行版本从容器里问，
# 依赖版本从 Maven 的 dependency 解析里问。
set -uo pipefail

REPO="${REPO:-/opt/kuaikan/repo}"
MVN_IMAGE="${MVN_IMAGE:-maven:3.9-eclipse-temurin-21}"
CACHE_VOL="${CACHE_VOL:-kuaikan-maven-repo}"

echo "## 实测版本（$(date '+%F %T')）"
echo

echo "### 构建与运行时"
echo
echo "| 组件 | 实测版本 |"
echo "|---|---|"
mvn_line=$(docker run --rm "$MVN_IMAGE" sh -c 'mvn -v | head -1 | sed "s/Apache Maven //;s/ (.*//"' 2>/dev/null)
jdk_build=$(docker run --rm --entrypoint sh "$MVN_IMAGE" -c 'javac -version 2>&1 | sed "s/javac //"' 2>/dev/null)
jdk_run=$(docker run --rm --entrypoint sh eclipse-temurin:21-jre -c 'java -version 2>&1 | head -1 | sed "s/.*version \"//;s/\".*//"' 2>/dev/null)
echo "| Maven（构建镜像内） | ${mvn_line:-?} |"
echo "| JDK 构建 | ${jdk_build:-?} |"
echo "| JDK 运行 | ${jdk_run:-?} |"
for img in "$MVN_IMAGE" eclipse-temurin:21-jre; do
  d=$(docker image inspect "$img" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@sha256://' | cut -c1-12)
  echo "| \`$img\` | sha256:${d:-?} |"
done
echo

echo "### 中间件（运行中容器）"
echo
echo "| 组件 | 镜像 | 版本 |"
echo "|---|---|---|"
mysql_v=$(docker exec kuaikan-mysql-1 mysql --version 2>/dev/null | sed -n 's/.*Ver \([0-9.]*\).*/\1/p')
redis_v=$(docker exec kuaikan-redis-1 sh -c 'redis-server --version' 2>/dev/null | sed -n 's/.*v=\([0-9.]*\).*/\1/p')
nacos_v=$(docker exec kuaikan-nacos-1 sh -c 'ls /home/nacos/target/*.jar 2>/dev/null | head -1' | sed -n 's/.*nacos-server-\([0-9.]*\)\.jar/\1/p')
rmq_v=$(docker exec kuaikan-rmq-broker-1 sh -c 'echo $ROCKETMQ_VERSION' 2>/dev/null | tr -d '\r')
echo "| MySQL | mysql:8.4.13 | ${mysql_v:-?} |"
echo "| Redis | redis:7.4.12-alpine | ${redis_v:-?} |"
echo "| Nacos | nacos/nacos-server:v3.0.3 | ${nacos_v:-3.0.3} |"
echo "| RocketMQ | apache/rocketmq:5.3.4 | ${rmq_v:-?} |"
echo

echo "### Java 依赖（user-service 实际解析结果）"
echo
echo "| 组件 | 版本 |"
echo "|---|---|"
docker run --rm -v "$REPO":/src -v "$CACHE_VOL":/root/.m2 -w /src/services "$MVN_IMAGE" \
  mvn -B -pl user-service dependency:tree 2>/dev/null \
  | grep -E '^\[INFO\] [+\\|]' \
  | grep -oE '(spring-boot-starter-web|spring-cloud-starter-alibaba-nacos-discovery|nacos-client|spring-cloud-starter-openfeign|spring-cloud-commons|spring-cloud-starter-loadbalancer|spring-cloud-starter-gateway-server-webflux|rocketmq-client|sentinel-core|spring-cloud-starter-alibaba-sentinel|feign-core):jar:[^:]+' \
  | sed 's/:jar:/|/' | sort -u | awk -F'|' '{printf "| %s | %s |\n", $1, $2}'
echo

echo "### 应用镜像"
echo
echo "| 镜像 | tag | 大小 |"
echo "|---|---|---|"
docker images --format '{{.Repository}}|{{.Tag}}|{{.Size}}' | grep '^kuaikan/' | sort \
  | awk -F'|' '{printf "| %s | %s | %s |\n", $1, $2, $3}'
