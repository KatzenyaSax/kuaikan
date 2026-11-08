# 采用 Spring Cloud Alibaba 体系，对内用 OpenFeign

中间件走 Spring Cloud Alibaba 生态（Nacos / Sentinel / RocketMQ / SkyWalking），这是国内互联网公司的事实标准形态。服务间调用选用 OpenFeign 而非 Dubbo 3：作者对 Feign 更熟、调试链路更短、与 Spring Cloud Gateway 的整合无摩擦。代价是牺牲了一部分内网 RPC 的拟真度与性能——但容量基线只有峰值 50 并发，HTTP/1.1 + 连接池完全够用，这个性能差异在本项目中不可观测。

## Considered Options

- **Dubbo 3 Triple**：更贴近阿里内网形态，能讲服务治理与泛化调用；成本是引入第二套 RPC 心智、且与 Boot 3.5 的兼容性需要额外验证。
- **纯 Spring Cloud 原生（Eureka/Consul + Resilience4j）**：与国内岗位相关性低。

## Consequences

- 版本矩阵以第 0 天 spike 的实测结果为准，不采信任何博客结论；spike 不通就整体降版本，不允许单独降某个组件。
- 所有服务对外统一暴露 REST，服务间调用也走 HTTP，内网延迟不设优化目标。
- **Seata 不在本方案中**：当时把它列为生态候选，但后续 ADR 0004 用本地消息表 + 对账覆盖了全部分布式事务场景，引入 Seata 已无收益。
