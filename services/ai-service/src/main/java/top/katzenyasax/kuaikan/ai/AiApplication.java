package top.katzenyasax.kuaikan.ai;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.scheduling.annotation.EnableScheduling;
import top.katzenyasax.kuaikan.ai.config.AiProperties;

@SpringBootApplication
@MapperScan("top.katzenyasax.kuaikan.ai.mapper")
@EnableDiscoveryClient
@EnableScheduling
@EnableFeignClients
@EnableConfigurationProperties(AiProperties.class)
public class AiApplication {

    public static void main(String[] args) {
        SpringApplication.run(AiApplication.class, args);
    }
}
