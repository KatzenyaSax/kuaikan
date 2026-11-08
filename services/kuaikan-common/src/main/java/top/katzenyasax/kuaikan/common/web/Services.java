package top.katzenyasax.kuaikan.common.web;

/**
 * 服务名常量，与 spring.application.name 一一对应，供 Feign 与路由引用。
 */
public final class Services {

    public static final String GATEWAY = "gateway";
    public static final String USER = "user-service";
    public static final String COMMUNITY = "community-service";
    public static final String CONTENT = "content-service";
    public static final String INTERACTION = "interaction-service";
    public static final String NOTIFICATION = "notification-service";
    public static final String SEARCH = "search-service";
    public static final String RANK = "rank-service";

    private Services() {
    }
}
