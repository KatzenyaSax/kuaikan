package top.katzenyasax.kuaikan.common.web.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.ErrorHttpStatus;

/**
 * 统一异常出口，全服务共用一份。
 *
 * HTTP 状态码来自 {@link ErrorHttpStatus}（与 contract/error-codes.json 对齐）。
 * 关键：401 只留给"凭证无效"，**登录失败不是 401**——否则前端 401 拦截器
 * 会去调 refresh，形成"输错密码 → 跳登录页"的死循环（见 p1-auth.md §4）。
 *
 * 这个类原本在 user-service 里，P2.1 把它移到 common-web：**没有它的服务，
 * 任何 BizException 都会漏成 Spring 默认的 500 页面**，前端拿不到 code，
 * 于是"业务错误一律走 code"这条契约直接失效。它必须和 UserContextFilter
 * 一样是"引了 common-web 就自动有"，而不是每个服务各抄一份。
 *
 * 注意：本类不在任何服务的 @ComponentScan 包下，靠 WebAutoConfiguration 里的
 * @Bean 注册（Spring 会识别 bean 上的 @RestControllerAdvice）。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ResponseEntity<Result<Void>> handleBiz(BizException e) {
        int status = ErrorHttpStatus.of(e.code());
        if (status >= 500) {
            log.error("业务异常（5xx）code={} message={}", e.code(), e.getMessage(), e);
        } else {
            log.info("业务异常 code={} message={}", e.code(), e.getMessage());
        }
        return ResponseEntity.status(status).body(Result.fail(e.code(), e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Result<Void>> handleValidation(MethodArgumentNotValidException e) {
        // 只回第一个字段错误：前端按字段定位，多字段错误列表对表单没有价值
        FieldError first = e.getBindingResult().getFieldErrors().stream().findFirst().orElse(null);
        String message = first != null && first.getDefaultMessage() != null
                ? first.getDefaultMessage()
                : CommonErrorCode.PARAM_INVALID.message();
        // 字段级错误用 PARAM_INVALID，前端据此把文案挂到具体输入框上
        return ResponseEntity.ok(Result.fail(CommonErrorCode.PARAM_INVALID.code(), message));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<Void>> handleOther(Exception e) {
        log.error("未预期异常", e);
        return ResponseEntity.status(ErrorHttpStatus.of(CommonErrorCode.INTERNAL.code()))
                .body(Result.fail(CommonErrorCode.INTERNAL));
    }
}
