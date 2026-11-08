package top.katzenyasax.kuaikan.user.sentinel;

import com.alibaba.csp.sentinel.annotation.aspectj.SentinelResourceAspect;
import com.alibaba.csp.sentinel.slots.block.RuleConstant;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRule;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRuleManager;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * P0 限流规则。
 *
 * 目前规则写在代码里（loadRules），因为 P0 只验证「规则真的能拦」；
 * 持久化到 Nacos 数据源是 P7 的事——写在代码里的规则重启即重置，
 * 不能作为生产形态，这一点在 architecture §3 中已注明。
 */
@Configuration
public class P0SentinelConfig {

    /** 资源名，与 PingController 上的 @SentinelResource 一致 */
    public static final String RESOURCE = "p0Sentinel";

    /** P0 阈值：QPS 2。故意设得很低，方便用几条 curl 就验证出来 */
    public static final int QPS_LIMIT = 2;

    private static final Logger log = LoggerFactory.getLogger(P0SentinelConfig.class);

    @PostConstruct
    public void initRules() {
        FlowRule rule = new FlowRule();
        rule.setResource(RESOURCE);
        rule.setGrade(RuleConstant.FLOW_GRADE_QPS);
        rule.setCount(QPS_LIMIT);
        rule.setLimitApp("default");
        FlowRuleManager.loadRules(List.of(rule));
        log.info("P0 Sentinel 规则已加载：resource={} qps={}", RESOURCE, QPS_LIMIT);
    }

    @Bean
    public SentinelResourceAspect sentinelResourceAspect() {
        return new SentinelResourceAspect();
    }
}
