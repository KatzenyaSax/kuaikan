package top.katzenyasax.kuaikan.user.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 只取 BCrypt，不引 spring-boot-starter-security。
 * 后者会带进整条 servlet 过滤器链与默认登录页，在 P1 没有任何用处。
 */
@Configuration
public class AuthConfig {

    /** 强度 10：单次校验约 60~80ms，对登录频率是可接受的成本 */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(10);
    }
}
