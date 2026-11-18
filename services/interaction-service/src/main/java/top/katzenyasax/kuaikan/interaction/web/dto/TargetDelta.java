package top.katzenyasax.kuaikan.interaction.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 某个目标在窗口内的新增互动数。
 *
 * 既是 Mapper 的投影载体（`SELECT target_id, COUNT(*)`），也是内部接口的返回元素。
 * 字段名与 SQL 别名一致，省一次映射配置。
 */
public record TargetDelta(
        @Schema(type = "string", description = "被作用的对象 id") Long targetId,
        @Schema(description = "窗口内新增数量") long cnt
) {
}
