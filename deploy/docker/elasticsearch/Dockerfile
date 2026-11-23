# syntax=docker/dockerfile:1.7
#
# Elasticsearch 8.17.4 + analysis-ik（中文分词）镜像，P6 全文搜索的底座。
#
#   docker build -f deploy/docker/elasticsearch/Dockerfile \
#     -t kuaikan/elasticsearch:8.17.4-ik8.17.4 deploy/docker/elasticsearch
#
# 为什么自己构建，而不是"起容器后进装插件"：
#   插件的安装物在 /usr/share/elasticsearch/plugins 下，属于**容器可写层**。
#   一旦容器被 compose 重建（换镜像、改配置都会），插件就没了 ——
#   而 ES 起不来的时候你看到的是 mapping 里 ik_max_word 找不到分析器，
#   报错点在索引侧，完全指不到"插件丢了"。所以插件必须在**构建期**进镜像。
#
# 版本对齐：analysis-ik 必须是 ES 的**精确同版本**（8.17.4 ↔ 8.17.4）。
#   IK 是 ES 的内部插件，直接引用 Lucene/ES 的内部类，小版本不匹配会在
#   启动时抛 NoSuchMethodError / IllegalAccessError，而不是安装时。
#   升级 ES 时这两个 ARG 必须一起改（compose.yml 里也是成对传的）。
#
# 签名：analysis-ik 不是 Elastic 官方签名插件，安装时会警告额外权限
#   （SocketPermission connect,resolve，用于加载 dict 时的自检）。
#   `--batch` 表示"已知风险，不再交互确认"。不加它构建会卡在 y/N 上。
#
# 运行阶段不写 USER：基础镜像已经是 1000:0（elasticsearch），
#   plugins 目录属主就是它，不需要为了装插件切 root。

ARG ES_VERSION=8.17.4
FROM docker.elastic.co/elasticsearch/elasticsearch:${ES_VERSION}

ARG IK_VERSION=8.17.4

RUN bin/elasticsearch-plugin install --batch \
      "https://get.infini.cloud/elasticsearch/analysis-ik/${IK_VERSION}" \
 && bin/elasticsearch-plugin list | grep -qx analysis-ik \
 && echo "analysis-ik ${IK_VERSION} 已装入镜像"
