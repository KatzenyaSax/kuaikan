package top.katzenyasax.kuaikan.common.web.config;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;

import java.time.LocalDateTime;

/**
 * 审计字段自动填充，全服务共用一份。
 *
 * 为什么不用数据库的 DEFAULT CURRENT_TIMESTAMP：**插入后实体上仍是 null**，
 * 接口直接返回实体就会漏字段。让应用层填值，返回值和库里的值必然一致。
 * 数据库默认值保留作为兜底（手工 SQL 插入的场景）。
 *
 * mybatis-plus 在 common-web 里是 optional 依赖，不连库的服务（gateway）
 * 因 @ConditionalOnClass 不会加载这个配置。
 */
@AutoConfiguration
@ConditionalOnClass(MetaObjectHandler.class)
public class MybatisAuditConfig {

    @Bean
    public MetaObjectHandler mybatisAuditHandler() {
        return new MetaObjectHandler() {
            @Override
            public void insertFill(MetaObject metaObject) {
                LocalDateTime now = LocalDateTime.now();
                strictInsertFill(metaObject, "createdAt", LocalDateTime.class, now);
                strictInsertFill(metaObject, "updatedAt", LocalDateTime.class, now);
            }

            @Override
            public void updateFill(MetaObject metaObject) {
                strictUpdateFill(metaObject, "updatedAt", LocalDateTime.class, LocalDateTime.now());
            }
        };
    }
}
