package top.katzenyasax.kuaikan.interaction.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;

/**
 * 点赞/收藏的目标。
 *
 * 对外用字符串 {@code "post"|"comment"}（和 states 接口的写法一致），
 * 内部再转成 tinyint。对外用枚举数字会让前端被迫知道数据库编码。
 */
public record TargetRequest(
        @NotBlank(message = "必须指定目标类型") String targetType,
        @NotNull(message = "必须指定目标 id")
        @io.swagger.v3.oas.annotations.media.Schema(type = "string") Long targetId
) {
    public int targetTypeValue() {
        return switch (targetType) {
            case "post" -> 1;
            case "comment" -> 2;
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID, "目标类型只能是 post 或 comment");
        };
    }

    public long targetIdValue() {
        return targetId;
    }
}
