package top.katzenyasax.kuaikan.ai.tool;

import java.util.List;
import java.util.Map;

/**
 * 声明给模型的 13 个工具 Schema（7 只读 + 6 写提议）及前端进度标签。
 */
public final class AiToolSchema {

    public static final List<Map<String, Object>> ALL_TOOLS = List.of(
            tool("search_posts", "按关键词、作者或社群检索站内公开帖子（含正文摘要）", Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "keyword", prop("string", "搜索关键词，可为空"),
                            "communityName", prop("string", "社群名过滤，可为空"),
                            "authorNickname", prop("string", "作者昵称过滤，可为空"),
                            "limit", prop("integer", "返回条数 1~8")
                    )
            )),
            tool("get_post", "读取指定帖子的完整正文与元数据", Map.of(
                    "type", "object",
                    "properties", Map.of("postId", prop("string", "帖子 ID")),
                    "required", List.of("postId")
            )),
            tool("get_comments", "读取指定帖子的热门评论列表（最多 50 条）", Map.of(
                    "type", "object",
                    "properties", Map.of("postId", prop("string", "帖子 ID")),
                    "required", List.of("postId")
            )),
            tool("list_unread_messages", "读取当前登录用户自己的未读站内消息", Map.of(
                    "type", "object",
                    "properties", Map.of("limit", prop("integer", "返回条数，默认 15"))
            )),
            tool("list_my_communities", "查看当前用户已加入的社群列表", Map.of(
                    "type", "object",
                    "properties", Map.of()
            )),
            tool("list_my_favorites", "查看当前用户最近收藏的帖子", Map.of(
                    "type", "object",
                    "properties", Map.of("limit", prop("integer", "返回条数，默认 20"))
            )),
            tool("list_communities", "查看全站公开社群列表", Map.of(
                    "type", "object",
                    "properties", Map.of()
            )),
            tool("propose_create_post", "生成发帖确认卡提议（不会直接发布，需用户点击确认）", Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "communityId", prop("string", "目标社群 ID"),
                            "communityName", prop("string", "目标社群名称，可为空"),
                            "title", prop("string", "帖子标题 1~120 字"),
                            "body", prop("string", "帖子 Markdown 正文")
                    ),
                    "required", List.of("communityId", "title", "body")
            )),
            tool("propose_favorite_posts", "生成批量收藏帖子确认卡提议（需用户勾选确认）", Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "postIds", Map.of("type", "array", "items", prop("string", "帖子 ID"),
                                    "description", "待收藏帖子 ID 列表")
                    ),
                    "required", List.of("postIds")
            )),
            tool("propose_follow_user", "生成关注作者确认卡提议", Map.of(
                    "type", "object",
                    "properties", Map.of("targetUserId", prop("string", "目标用户 ID")),
                    "required", List.of("targetUserId")
            )),
            tool("propose_join_community", "生成加入社群确认卡提议", Map.of(
                    "type", "object",
                    "properties", Map.of("communityName", prop("string", "目标社群名称")),
                    "required", List.of("communityName")
            )),
            tool("propose_update_nickname", "生成修改当前用户昵称确认卡提议", Map.of(
                    "type", "object",
                    "properties", Map.of("nickname", prop("string", "新昵称 2~32 字")),
                    "required", List.of("nickname")
            )),
            tool("propose_update_avatar", "生成修改当前用户头像外链确认卡提议", Map.of(
                    "type", "object",
                    "properties", Map.of("avatarUrl", prop("string", "头像 http(s) 链接，空串表示清空")),
                    "required", List.of("avatarUrl")
            ))
    );

    public static String toolLabel(String name) {
        if (name == null) {
            return "正在执行工具…";
        }
        return switch (name) {
            case "search_posts" -> "正在搜索站内帖子…";
            case "get_post" -> "正在读取帖子详情…";
            case "get_comments" -> "正在读取热门评论…";
            case "list_unread_messages" -> "正在读取未读消息…";
            case "list_my_communities" -> "正在查看已加入的社群…";
            case "list_my_favorites" -> "正在查看我的收藏…";
            case "list_communities" -> "正在获取社群列表…";
            case "propose_create_post" -> "正在准备发帖确认卡…";
            case "propose_favorite_posts" -> "正在整理收藏确认卡…";
            case "propose_follow_user" -> "正在准备关注确认卡…";
            case "propose_join_community" -> "正在准备入群确认卡…";
            case "propose_update_nickname" -> "正在准备改昵称确认卡…";
            case "propose_update_avatar" -> "正在准备改头像确认卡…";
            default -> "正在执行 " + name + "…";
        };
    }

    private static Map<String, Object> tool(String name, String description, Map<String, Object> parameters) {
        return Map.of(
                "type", "function",
                "function", Map.of(
                        "name", name,
                        "description", description,
                        "parameters", parameters
                )
        );
    }

    private static Map<String, Object> prop(String type, String desc) {
        return Map.of("type", type, "description", desc);
    }

    private AiToolSchema() {
    }
}
