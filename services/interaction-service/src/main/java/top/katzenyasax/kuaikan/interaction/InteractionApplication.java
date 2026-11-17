package top.katzenyasax.kuaikan.interaction;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication
// 显式声明：kuaikan-common-outbox 的 OutboxMapper 不在本服务包下，自动扫描找不到它。
// 注意加了 @MapperScan 会关掉 MyBatis-Plus 的自动扫描，所以本服务自己的 mapper 包也要列上。
@MapperScan({"top.katzenyasax.kuaikan.interaction.mapper",
        "top.katzenyasax.kuaikan.common.outbox"})
@EnableDiscoveryClient
@EnableScheduling
@EnableFeignClients
public class InteractionApplication {

    public static void main(String[] args) {
        SpringApplication.run(InteractionApplication.class, args);
    }
}
