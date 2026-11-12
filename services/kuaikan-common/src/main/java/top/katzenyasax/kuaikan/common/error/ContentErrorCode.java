package top.katzenyasax.kuaikan.common.error;

/**
 * 内容（帖子/评论）相关错误码（420xx）。
 *
 * 唯一事实来源是 contract/error-codes.json —— 改这里必须同步改 JSON，
 * 并由 `node deploy/bin/check-contract.mjs` 校验。
 *
 * 注意这里**只有「帖子不存在」一个码**。参数问题（标题超长、正文为空、
 * 游标非法、sort 未实现）一律用 {@link CommonErrorCode#PARAM_INVALID}，
 * 不在这里为每种字段再造一个码——字段级错误由校验注解给出具体文案。
 */
public enum ContentErrorCode implements ErrorCode {

    POST_NOT_FOUND(42001, "帖子不存在");

    private final int code;
    private final String message;

    ContentErrorCode(int code, String message) {
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
