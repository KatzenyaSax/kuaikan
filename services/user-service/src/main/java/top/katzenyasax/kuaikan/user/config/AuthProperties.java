package top.katzenyasax.kuaikan.user.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 注册相关参数。真值可放 Nacos 配置中心热切换（register-enabled）。
 */
@Component
@ConfigurationProperties(prefix = "kuaikan.auth")
public class AuthProperties {

    /** 注册开关，默认关闭。Nacos 里可热切换 */
    private boolean registerEnabled = false;

    private Duration codeTtl = Duration.ofMinutes(10);

    private int codeLength = 6;

    /** 验证码最多可试错几次，超过即作废 */
    private int codeMaxAttempts = 5;

    /** 同一邮箱重发间隔 */
    private Duration codeResendInterval = Duration.ofSeconds(60);

    /** 同一 IP 每小时的发送上限 */
    private int codeIpHourlyLimit = 10;

    public boolean isRegisterEnabled() { return registerEnabled; }
    public void setRegisterEnabled(boolean registerEnabled) { this.registerEnabled = registerEnabled; }

    public Duration getCodeTtl() { return codeTtl; }
    public void setCodeTtl(Duration codeTtl) { this.codeTtl = codeTtl; }

    public int getCodeLength() { return codeLength; }
    public void setCodeLength(int codeLength) { this.codeLength = codeLength; }

    public int getCodeMaxAttempts() { return codeMaxAttempts; }
    public void setCodeMaxAttempts(int codeMaxAttempts) { this.codeMaxAttempts = codeMaxAttempts; }

    public Duration getCodeResendInterval() { return codeResendInterval; }
    public void setCodeResendInterval(Duration codeResendInterval) { this.codeResendInterval = codeResendInterval; }

    public int getCodeIpHourlyLimit() { return codeIpHourlyLimit; }
    public void setCodeIpHourlyLimit(int codeIpHourlyLimit) { this.codeIpHourlyLimit = codeIpHourlyLimit; }
}
