package top.katzenyasax.kuaikan.user.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 关注相关参数。真值可放 Nacos 配置中心热切换。
 */
@Component
@ConfigurationProperties(prefix = "kuaikan.follow")
public class FollowProperties {

    /**
     * 单人关注上限，默认 200（docs/design/p55-social.md §6.4）。
     *
     * 它不是强金融约束：普通操作精确卡死 200，极端并发下最多多出 1~2 条。
     * 为此加用户行锁或分布式锁是过度设计。
     */
    private int maxFollowing = 200;

    public int getMaxFollowing() { return maxFollowing; }
    public void setMaxFollowing(int maxFollowing) { this.maxFollowing = maxFollowing; }
}
