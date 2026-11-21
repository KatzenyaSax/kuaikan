package top.katzenyasax.kuaikan.content.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 内容相关参数。真值可放 Nacos 配置中心热切换（与 user-service 的 FollowProperties 同构）。
 */
@Component
@ConfigurationProperties(prefix = "kuaikan.content")
public class ContentProperties {

    /**
     * 单次按作者集合拉帖的上限，默认 200（docs/design/p55-social.md §3.3）。
     *
     * 200 不是随便定的：单人关注上限就是 200，所以「全部关注」的时间线
     * 一次就能取全，前端不需要为了拉一屏帖子先翻几页关注列表。
     *
     * 上限同时是一个**请求体体积约束**——200 个 19 位雪花 id 大约 4 KB，
     * 这正是 by-authors 用 POST body 而不是 query string 的原因。
     */
    private int maxAuthorIds = 200;

    public int getMaxAuthorIds() { return maxAuthorIds; }

    public void setMaxAuthorIds(int maxAuthorIds) { this.maxAuthorIds = maxAuthorIds; }
}
