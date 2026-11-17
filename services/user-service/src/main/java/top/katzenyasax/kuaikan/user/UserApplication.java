package top.katzenyasax.kuaikan.user;

import org.springframework.boot.SpringApplication;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication
// 显式声明 Mapper 扫描：加了 @MapperScan 会关掉 MyBatis-Plus 的自动扫描，
// 所以本服务的 mapper 包必须自己列出来（同理要带上 common-outbox 的包）。
@MapperScan({"top.katzenyasax.kuaikan.user.mapper",
        "top.katzenyasax.kuaikan.common.outbox"})
@EnableDiscoveryClient
@EnableFeignClients
public class UserApplication {

    public static void main(String[] args) {
        SpringApplication.run(UserApplication.class, args);
    }
}
