package top.katzenyasax.kuaikan.common.web.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
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

    @Bean
    public FilterRegistrationBean<UserContextFilter> userContextFilter() {
        FilterRegistrationBean<UserContextFilter> bean = new FilterRegistrationBean<>(new UserContextFilter());
        bean.addUrlPatterns("/*");
        // 尽早执行：后面的任何过滤器/拦截器都可能需要身份
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return bean;
    }
}
