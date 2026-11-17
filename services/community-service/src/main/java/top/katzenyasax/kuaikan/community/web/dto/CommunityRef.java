package top.katzenyasax.kuaikan.community.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 内部：按 id 拿社群的标识信息。
 *
 * 只用来回答"这个 id 叫什么名字"，给 notification 拼消息快照
 * （消息里要存社群名，点消息才能跳到 `/c/{社群名}/p/{帖子id}`）。
 *
 * 用 exists + name 而不是抛异常：内部查询接口回答"是什么"，不是"做什么"。
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CommunityRef(boolean exists, String name) {
    public static CommunityRef missing() {
        return new CommunityRef(false, null);
    }

    public static CommunityRef of(String name) {
        return new CommunityRef(true, name);
    }
}
