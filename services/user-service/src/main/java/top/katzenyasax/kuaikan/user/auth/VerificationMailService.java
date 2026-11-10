package top.katzenyasax.kuaikan.user.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.MailSender;
import org.springframework.stereotype.Service;

/**
 * 发信抽象。
 *
 * P1 用 MailHog 的假 SMTP 打通全链路；上线前替换实现即可，
 * 注册业务流程一行都不用改（见 p1-auth.md §11：P1 不接真实邮件服务）。
 *
 * 没有配置 MAIL_HOST 时退化为打日志，保证本地/CI 也能跑通注册流程。
 */
@Service
public class VerificationMailService {

    private static final Logger log = LoggerFactory.getLogger(VerificationMailService.class);

    private final MailSender mailSender;
    private final String from;
    private final boolean smtpAvailable;

    public VerificationMailService(
            ObjectProvider<MailSender> mailSenderProvider,
            @Value("${spring.mail.host:}") String mailHost,
            @Value("${kuaikan.mail.from:no-reply@kuaikan.local}") String from) {
        this.mailSender = mailSenderProvider.getIfAvailable();
        this.from = from;
        this.smtpAvailable = mailSender != null && mailHost != null && !mailHost.isBlank();
    }

    public void sendRegisterCode(String email, String code) {
        if (!smtpAvailable) {
            // 退化路径：故意用 WARN，让它在日志里显眼。不要用 DEBUG 藏着。
            log.warn("[MAIL-DISABLED] 注册验证码 email={} code={}（未配置 SMTP，仅日志输出）", email, code);
            return;
        }

        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("kuaikan 注册验证码");
        message.setText("你的验证码是 " + code + "，10 分钟内有效。\n\n如果不是你本人操作，请忽略这封邮件。");
        mailSender.send(message);
        log.info("注册验证码已发送 email={}", email);
    }
}
