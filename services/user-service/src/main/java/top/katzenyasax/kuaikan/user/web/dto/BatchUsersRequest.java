package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 内部批量取用户昵称（P6.1）。给 search-service 补齐 {@code authorNickname} 用。
 *
 * <b>id 按字符串接收</b>：雪花 id 超出 JS 安全整数范围，全站 id 一律字符串。
 * 服务端解析为正 Long 并去重保序；非法数字、非正整数、超过 200 个一律 40010。
 *
 * 上限 200 与 content 的 {@code by-authors} 对齐：一批索引回填最多收集 200 个作者。
 * null / 空列表不是错误：直接返回空列表，调用方不必特殊分支。
 */
public record BatchUsersRequest(
        @ArraySchema(
                arraySchema = @Schema(description = "用户 id 列表（字符串雪花 id）；上限 200"),
                schema = @Schema(type = "string"))
        List<String> ids
) {
}
