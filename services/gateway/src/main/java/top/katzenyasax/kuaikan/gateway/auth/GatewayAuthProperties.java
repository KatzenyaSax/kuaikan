package top.katzenyasax.kuaikan.gateway.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 放行名单。
 *
 * **必须用 @ConfigurationProperties 而不是 @Value**：
 * @Value 只能绑定逗号分隔的字符串，绑 YAML 列表会得到空值或一整串乱码——
 * 而这里绑错的后果是所有请求都被拒（连登录都不通），排查方向还很容易跑偏。
 */
@Component
@ConfigurationProperties(prefix = "kuaikan.auth")
public class GatewayAuthProperties {

    /** 精确匹配放行：登录前必然未认证的端点 */
    private List<String> whitelist = new ArrayList<>();

    /** 正则放行：P0/P0.5 的探针端点 */
    private List<String> publicPatterns = new ArrayList<>();

    /** 公钥来源 */
    private String jwksUri = "http://user-service:8081/internal/jwks";


    public List<String> getWhitelist() { return whitelist; }
    public void setWhitelist(List<String> whitelist) { this.whitelist = whitelist; }

    public List<String> getPublicPatterns() { return publicPatterns; }
    public void setPublicPatterns(List<String> publicPatterns) { this.publicPatterns = publicPatterns; }

    public String getJwksUri() { return jwksUri; }
    public void setJwksUri(String jwksUri) { this.jwksUri = jwksUri; }

}
