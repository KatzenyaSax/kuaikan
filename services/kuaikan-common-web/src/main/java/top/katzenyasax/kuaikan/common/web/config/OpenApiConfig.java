package top.katzenyasax.kuaikan.common.web.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;

import java.util.List;

/**
 * 所有服务的 OpenAPI 由这一份配置统一描述，避免每个服务抄一遍。
 *
 * 要点：**全局声明 bearerAuth**，于是 spec 的默认语义是"需要认证"。
 * 被 {@link PublicEndpoint} 标记的端点显式清空 security，变成 `security: []`。
 *
 * 为什么要这样做：没有全局 security 时，`security: []` 毫无意义，
 * 而一个不声明认证方式的 spec 等于对"谁能访问"保持沉默——
 * 那样网关白名单就成了唯一的事实来源，也就无法被校验。
 */
@AutoConfiguration
@ConditionalOnClass(OpenAPI.class)
public class OpenApiConfig {

    @Bean
    public OpenAPI kuaikanOpenApi() {
        return new OpenAPI()
                .info(new Info().title("kuaikan").version("1"))
                .components(new Components().addSecuritySchemes("bearerAuth",
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("网关验签的 access token。登录后在 Authorization 头里带 Bearer <token>。")))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"));
    }

    @Bean
    public OperationCustomizer publicEndpointSecurityCustomizer() {
        return (operation, handlerMethod) -> {
            if (handlerMethod.hasMethodAnnotation(PublicEndpoint.class)) {
                operation.setSecurity(List.of());
            }
            return operation;
        };
    }
}
