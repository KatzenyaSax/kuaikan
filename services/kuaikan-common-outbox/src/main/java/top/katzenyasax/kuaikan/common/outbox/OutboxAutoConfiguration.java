package top.katzenyasax.kuaikan.common.outbox;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * outbox 的自动配置。
 *
 * 使用方只需要三件事：
 * <ol>
 *   <li>pom 里加 {@code kuaikan-common-outbox} 依赖</li>
 *   <li>自己的 schema 里建 {@code t_outbox}（结构照搬，见任一服务迁移）</li>
 *   <li>配置 {@code kuaikan.outbox.enabled=true}，
 *       并把 outbox 包纳入 {@code @MapperScan}（原因见 {@link OutboxMapper}）</li>
 * </ol>
 *
 * <b>为什么默认关闭</b>：不开的后果只是不发事件；而误开的后果是每秒扫一张
 * 不存在的表，日志刷屏还掩盖真正的错误。宁可让使用者多写一行。
 */
@AutoConfiguration
@ConditionalOnClass({DefaultMQProducer.class, com.baomidou.mybatisplus.core.mapper.BaseMapper.class})
@ConditionalOnProperty(prefix = "kuaikan.outbox", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(OutboxProperties.class)
public class OutboxAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public OutboxProducer outboxProducer(
            OutboxProperties properties,
            @Value("${spring.application.name:service}") String applicationName,
            // MQ 地址统一从 kuaikan.mq.namesrv-addr 取，与消费端同一个来源
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr) {
        return new OutboxProducer(
                applicationName, namesrvAddr, properties.getProducerGroup());
    }

    @Bean
    @ConditionalOnMissingBean
    public OutboxRelay outboxRelay(OutboxMapper outboxMapper,
                                   OutboxProducer producer,
                                   OutboxProperties properties) {
        return new OutboxRelay(outboxMapper, producer, properties);
    }
}
