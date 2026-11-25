package top.katzenyasax.kuaikan.common.error;

/**
 * AI 助手相关错误码（440xx）。
 *
 * 唯一事实来源是 contract/error-codes.json —— 改这里必须同步改 JSON，
 * 并由 `node deploy/bin/check-contract.mjs` 校验。
 */
public enum AiErrorCode implements ErrorCode {

    AI_QUOTA_EXCEEDED(44001, "今日 AI 对话次数已用完"),
    AI_STREAM_BUSY(44002, "已有正在进行的回答，请稍候"),
    AI_UNAVAILABLE(44003, "AI 服务暂时不可用"),
    AI_CONVERSATION_NOT_FOUND(44004, "对话不存在或无权访问"),
    AI_ACTION_EXPIRED(44005, "该操作提议已过期，请重新发起"),
    AI_ACTION_STATE_INVALID(44006, "操作提议状态不允许此操作");

    private final int code;
    private final String message;

    AiErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    @Override
    public int code() {
        return code;
    }

    @Override
    public String message() {
        return message;
    }
}
