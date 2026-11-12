package top.katzenyasax.kuaikan.common.web.config;

import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;

/**
 * 把 Long 序列化为字符串。
 *
 * 原因：JS 的 Number 只有 53 位精度，雪花 ID 是 19 位。后端直接输出裸数字时，
 * `2120067248267317249` 在浏览器里会变成 `2120067248267317200` ——
 * 表现为"注册成功了但查不到自己的账号"。这是静默错误，日志里看不出来。
 *
 * 全局生效（而不是逐个字段加注解），因为**漏一个字段就是一个线上事故**。
 * 代价是以后所有 Long 字段（比如计数）到前端都是字符串，需要时再单独处理。
 *
 * 注意：这只保证「实际 JSON 是字符串」。要让 OpenAPI 契约也写成 string，
 * DTO 上的字段还需要加 @Schema(type = "string")，否则生成的 TS 类型仍是 number。
 */
@AutoConfiguration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer longToStringCustomizer() {
        return builder -> {
            SimpleModule module = new SimpleModule("kuaikan-long-to-string");
            // 只注册包装类型：原始 long 是计数/时长，不能被转成字符串
            module.addSerializer(Long.class, ToStringSerializer.instance);
            builder.modulesToInstall(module);
        };
    }
}
