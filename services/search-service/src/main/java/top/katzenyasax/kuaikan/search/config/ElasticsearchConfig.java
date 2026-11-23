package top.katzenyasax.kuaikan.search.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

/**
 * ES 用的 HTTP 客户端。
 *
 * <h2>为什么是 Spring 的 {@link RestClient} 而不是 elasticsearch-java</h2>
 *
 * search-service 对 ES 的全部需求就是几个 REST 端点：
 * {@code _bulk} / {@code _aliases} / {@code _update_by_query} / {@code _refresh}。
 * 官方 Java 客户端会引入 transport 线程池、它自己的 Jackson 版本约束，
 * 和一个与"执行一条 JSON"不匹配的对象模型；而这里直接用 JSON 反而最可控。
 *
 * <h2>为什么用 JDK HttpClient 的 request factory</h2>
 *
 * {@code SimpleClientHttpRequestFactory} 基于 {@code HttpURLConnection}，不复用连接；
 * 消费端是持续写入的，每次新建 TCP 对 ES 不友好。JDK 的 {@link HttpClient}
 * 自带连接池，且能分别设置连接超时与读超时。
 *
 * <h2>ES 不可用不阻塞启动</h2>
 *
 * 这个 Bean 只构造客户端，**不发任何请求**。真正的连通性自检在
 * {@code IndexBootstrap} 里异步做，失败只记 WARN —— ES 停机时
 * search-service 必须照样活着（p6-search.md §2），readiness 也不包含 ES。
 */
@Configuration
@EnableConfigurationProperties(SearchProperties.class)
public class ElasticsearchConfig {

    @Bean
    public RestClient elasticsearchRestClient(SearchProperties props) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(props.getConnectTimeout())
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(props.getReadTimeout());
        return RestClient.builder()
                .baseUrl(props.getElasticsearchUri())
                .requestFactory(factory)
                .build();
    }
}
