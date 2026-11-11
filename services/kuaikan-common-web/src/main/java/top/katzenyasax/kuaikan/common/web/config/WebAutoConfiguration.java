package top.katzenyasax.kuaikan.common.web.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import top.katzenyasax.kuaikan.common.web.feign.IdentityPropagationInterceptor;
import top.katzenyasax.kuaikan.common.web.filter.UserContextFilter;

/**
 * servlet 服务的公共 Web 配置。
 *
 * 用 AutoConfiguration + Imports 文件注册，各服务只引依赖即可生效，
 * 不需要在每个服务里写 @Import 或扫描包（那些写法一旦有人改启动类就会失效）。
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class WebAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(WebAutoConfiguration.class);

    @Bean
    public FilterRegistrationBean<UserContextFilter> userContextFilter(
            @Value("${kuaikan.internal.auth.secret:}") String internalSecret) {
        // 密钥缺失时**启动即失败**：安全控件不允许静默降级成"不校验"。
        // 宁可服务起不来，也不要起一个任何人都能伪造身份的服。
        if (internalSecret == null || internalSecret.isBlank()) {
            throw new IllegalStateException(
                    "缺少 kuaikan.internal.auth.secret（环境变量 INTERNAL_AUTH_SECRET）。"
                            + "这是网关→服务的内部签名密钥，不允许留空。");
        }
        log.info("内部签名校验已启用");

        FilterRegistrationBean<UserContextFilter> bean =
                new FilterRegistrationBean<>(new UserContextFilter(internalSecret));
        bean.addUrlPatterns("/*");
        // 尽早执行：后面的任何过滤器/拦截器都可能需要身份
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return bean;
    }

    /**
     * Feign 身份传播。用 ConditionalOnClass(名字) 而不是类字面量，
     * 这样没有 openfeign 的服务也不会因为缺类而启动失败。
     */
    @Bean
    @ConditionalOnClass(name = "feign.RequestInterceptor")
    public IdentityPropagationInterceptor identityPropagationInterceptor() {
        log.info("Feign 身份传播拦截器已注册");
        return new IdentityPropagationInterceptor();
    }
}
