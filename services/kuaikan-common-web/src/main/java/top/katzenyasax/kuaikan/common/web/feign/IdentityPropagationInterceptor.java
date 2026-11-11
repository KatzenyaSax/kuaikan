package top.katzenyasax.kuaikan.common.web.feign;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import top.katzenyasax.kuaikan.common.web.Headers;

/**
 * 把入站请求的身份**原样转抄**到 Feign 出站请求上。
 *
 * 不写这个拦截器的后果：user-service 经 Feign 调 community-service 时，
 * Feign 会**构造一个全新的请求**（按方法签名重拼 URL/method/body），
 * 入站的 X-User-Id 与签名全部丢失 —— 下游看到的是匿名请求。
 *
 * 危险的不是报错，而是**静默返回错误结果**：用户明明赞过，页面显示未赞。
 *
 * 为什么是"转抄"而不是"重签"：
 *   重签意味着任何持有共享密钥的服务都能凭空造出任意身份，
 *   那把 B 方案建立的边界又拆掉一半。转抄的语义是"我在替这个用户办事"，
 *   而不是"我认为当前应该是这个用户"。
 *
 * 时间戳签名会随转抄一起带走。60 秒窗口对请求处理初期的 Feign 调用绰绰有余。
 *
 * **没有入站请求上下文时不传播**（RequestContextHolder 为 null）：
 * MQ 消费者、XXL-Job 定时任务都是系统行为，没有"当前用户"，
 * 它们需要用户上下文时必须从消息体里取，不能靠 header。
 */
public class IdentityPropagationInterceptor implements RequestInterceptor {

    private static final Logger log = LoggerFactory.getLogger(IdentityPropagationInterceptor.class);

    /** 一起转抄，缺一个下游就会 401（签名覆盖 userId|roles|timestamp） */
    private static final String[] PROPAGATED = {
            Headers.USER_ID,
            Headers.USER_ROLES,
            Headers.INTERNAL_TIMESTAMP,
            Headers.INTERNAL_SIGNATURE,
    };

    @Override
    public void apply(RequestTemplate template) {
        HttpServletRequest inbound = currentRequest();
        if (inbound == null) {
            // 非用户请求触发（定时任务 / MQ 消费）：不传播身份，下游按匿名处理
            return;
        }

        String userId = inbound.getHeader(Headers.USER_ID);
        if (userId == null || userId.isBlank()) {
            return;
        }

        for (String header : PROPAGATED) {
            String value = inbound.getHeader(header);
            if (value == null) {
                // 有身份却没签名 —— 直接不发，让下游明确拒绝，
                // 而不是发一个会被下游当成"签名不匹配"的半套头
                log.warn("入站请求带 {} 但缺少 {}，放弃身份传播", Headers.USER_ID, header);
                return;
            }
        }
        for (String header : PROPAGATED) {
            template.header(header, inbound.getHeader(header));
        }
    }

    private HttpServletRequest currentRequest() {
        var attrs = RequestContextHolder.getRequestAttributes();
        if (attrs instanceof ServletRequestAttributes servletAttrs) {
            return servletAttrs.getRequest();
        }
        return null;
    }
}
