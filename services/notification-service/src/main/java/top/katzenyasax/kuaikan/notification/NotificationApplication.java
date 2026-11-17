package top.katzenyasax.kuaikan.notification;

import org.springframework.boot.SpringApplication;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication
// 显式声明 Mapper 扫描：加了 @MapperScan 会关掉 MyBatis-Plus 的自动扫描
// （它带 @ConditionalOnMissingBean(MapperScannerConfigurer.class)），
// 所以本服务的 mapper 包必须自己列出来。
@MapperScan("top.katzenyasax.kuaikan.notification.mapper")
@EnableDiscoveryClient
@EnableFeignClients
public class NotificationApplication {

    public static void main(String[] args) {
        SpringApplication.run(NotificationApplication.class, args);
    }
}
