package top.katzenyasax.kuaikan.ai.tool;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.ai.config.AiProperties;
import top.katzenyasax.kuaikan.ai.domain.AiAction;
import top.katzenyasax.kuaikan.ai.feign.CommunityClient;
import top.katzenyasax.kuaikan.ai.feign.ContentClient;
import top.katzenyasax.kuaikan.ai.feign.InteractionClient;
import top.katzenyasax.kuaikan.ai.feign.NotificationClient;
import top.katzenyasax.kuaikan.ai.feign.SearchClient;
import top.katzenyasax.kuaikan.ai.feign.UserClient;
import top.katzenyasax.kuaikan.ai.mapper.AiActionMapper;
import top.katzenyasax.kuaikan.ai.web.dto.ActionProposalView;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;

/**
 * 执行 7 个只读工具与 6 个写提议工具（写提议只落 t_ai_action 并推确认卡，永不执行业务写）。
 */
@Component
public class AiToolExecutor {

    private static final Logger log = LoggerFactory.getLogger(AiToolExecutor.class);
    private static final int MAX_SEARCH_BODY = 1500;
    private static final int MAX_POST_BODY = 2500;
    private static final int MAX_COMMENT_BODY = 300;
    private static final int MAX_COMMENTS = 50;

    private final SearchClient searchClient;
    private final ContentClient contentClient;
    private final CommunityClient communityClient;
    private final UserClient userClient;
    private final NotificationClient notificationClient;
    private final InteractionClient interactionClient;
    private final AiActionMapper actionMapper;
    private final AiProperties props;
    private final ObjectMapper objectMapper;

    public AiToolExecutor(SearchClient searchClient,
                          ContentClient contentClient,
                          CommunityClient communityClient,
                          UserClient userClient,
                          NotificationClient notificationClient,
                          InteractionClient interactionClient,
                          AiActionMapper actionMapper,
                          AiProperties props,
                          ObjectMapper objectMapper) {
        this.searchClient = searchClient;
        this.contentClient = contentClient;
        this.communityClient = communityClient;
        this.userClient = userClient;
        this.notificationClient = notificationClient;
        this.interactionClient = interactionClient;
        this.actionMapper = actionMapper;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    public String execute(String name, String rawArgs, AiToolContext ctx,
                          Consumer<ActionProposalView> onAction) {
        try {
            JsonNode args = (rawArgs == null || rawArgs.isBlank())
                    ? objectMapper.createObjectNode()
                    : objectMapper.readTree(rawArgs);

            String result = switch (name) {
                case "search_posts" -> execSearchPosts(args, ctx);
                case "get_post" -> execGetPost(args, ctx);
                case "get_comments" -> execGetComments(args);
                case "list_unread_messages" -> execListUnreadMessages(args, ctx);
                case "list_my_communities" -> execListMyCommunities(ctx);
                case "list_my_favorites" -> execListMyFavorites(args, ctx);
                case "list_communities" -> execListCommunities();
                case "propose_create_post" -> execProposeCreatePost(args, ctx, onAction);
                case "propose_favorite_posts" -> execProposeFavoritePosts(args, ctx, onAction);
                case "propose_follow_user" -> execProposeFollowUser(args, ctx, onAction);
                case "propose_join_community" -> execProposeJoinCommunity(args, ctx, onAction);
                case "propose_update_nickname" -> execProposeUpdateNickname(args, ctx, onAction);
                case "propose_update_avatar" -> execProposeUpdateAvatar(args, ctx, onAction);
                default -> "未知工具: " + name;
            };
            return wrap(result);
        } catch (Exception e) {
            log.warn("工具执行异常 tool={} err={}", name, e.toString());
            return wrap("工具执行失败（下游暂不可用或参数有误），请换一种方式回答或告知用户。");
        }
    }

    private String execSearchPosts(JsonNode args, AiToolContext ctx) {
        String keyword = textOrNull(args, "keyword");
        String communityName = textOrNull(args, "communityName");
        String authorNickname = textOrNull(args, "authorNickname");
        int limit = clamp(args.path("limit").asInt(5), 1, 8);

        Result<PageResult<SearchClient.SearchPostRow>> res = searchClient.searchPosts(
                new SearchClient.SearchPostsReq(
                        keyword, null, authorNickname, null, communityName,
                        null, null, null, null, limit, true));
        List<SearchClient.SearchPostRow> items = (res != null && res.getData() != null && res.getData().items() != null)
                ? res.getData().items()
                : List.of();
        if (items.isEmpty()) {
            return "未检索到匹配的站内公开帖子。";
        }
        StringBuilder sb = new StringBuilder();
        for (SearchClient.SearchPostRow row : items) {
            int n = ctx.registerCitation(row.postId(), row.title(), row.communityName(), row.authorNickname());
            String body = truncate(row.body() != null ? row.body() : row.excerpt(), MAX_SEARCH_BODY);
            sb.append("[").append(n).append("] 《").append(safe(row.title())).append("》")
                    .append(" (postId=").append(row.postId())
                    .append(", 社群=").append(safe(row.communityName()))
                    .append(", 作者=").append(safe(row.authorNickname())).append(")\n")
                    .append(body).append("\n\n");
        }
        return sb.toString().trim();
    }

    private String execGetPost(JsonNode args, AiToolContext ctx) {
        Long postId = parseLong(textOrNull(args, "postId"));
        if (postId == null) {
            return "缺少有效的 postId。";
        }
        Result<ContentClient.PostRow> res = contentClient.getPost(postId);
        ContentClient.PostRow post = res == null ? null : res.getData();
        if (post == null) {
            return "帖子不存在或已被删除。";
        }

        String commName = resolveCommunityName(post.communityId());
        String authorNick = resolveUserNickname(post.authorId());
        int n = ctx.registerCitation(post.id(), post.title(), commName, authorNick);

        return "[" + n + "] 《" + safe(post.title()) + "》"
                + " (postId=" + post.id()
                + ", 社群=" + commName
                + ", 作者=" + authorNick
                + ", 评论数=" + post.commentCount()
                + ", 点赞数=" + post.likeCount()
                + ", 收藏数=" + post.favoriteCount() + ")\n"
                + truncate(post.body(), MAX_POST_BODY);
    }

    private String execGetComments(JsonNode args) {
        Long postId = parseLong(textOrNull(args, "postId"));
        if (postId == null) {
            return "缺少有效的 postId。";
        }
        Result<ContentClient.CommentPageRow> res = contentClient.listComments(postId, "hot", MAX_COMMENTS);
        List<ContentClient.CommentRow> items = (res != null && res.getData() != null && res.getData().items() != null)
                ? res.getData().items()
                : List.of();
        if (items.isEmpty()) {
            return "该帖子暂无评论。";
        }

        List<String> authorIds = items.stream()
                .map(ContentClient.CommentRow::authorId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<String, String> nickMap = batchNicknames(authorIds);

        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (ContentClient.CommentRow c : items) {
            if (c.deleted() || count >= MAX_COMMENTS) {
                continue;
            }
            count++;
            String nick = nickMap.getOrDefault(c.authorId(), "用户");
            sb.append("- ").append(nick)
                    .append(" (赞 ").append(c.likeCount()).append(", 回复 ").append(c.replyCount()).append("): ")
                    .append(truncate(c.body(), MAX_COMMENT_BODY)).append("\n");
        }
        return count == 0 ? "该帖子暂无有效评论。" : sb.toString().trim();
    }

    private String execListUnreadMessages(JsonNode args, AiToolContext ctx) {
        int limit = clamp(args.path("limit").asInt(15), 1, 30);
        // userId 严格由后端 UserContext 注入，绝不采信模型入参
        Result<List<NotificationClient.UnreadMessageRow>> res = notificationClient.listUnread(ctx.userId(), limit);
        List<NotificationClient.UnreadMessageRow> rows = res == null || res.getData() == null
                ? List.of() : res.getData();
        if (rows.isEmpty()) {
            return "暂无未读消息。";
        }
        StringBuilder sb = new StringBuilder();
        for (NotificationClient.UnreadMessageRow m : rows) {
            sb.append("- [").append(safe(m.type())).append("] ")
                    .append("发送人=").append(safe(m.actorNickname()))
                    .append(" (actorId=").append(safe(m.actorId())).append(")");
            if (m.targetTitle() != null) {
                sb.append(" 帖子《").append(m.targetTitle()).append("》");
            }
            if (m.communityName() != null && m.postId() != null) {
                sb.append(" [postId=").append(m.postId())
                        .append(", community=").append(m.communityName());
                if (m.commentId() != null) {
                    sb.append(", commentId=").append(m.commentId());
                }
                if (m.rootCommentId() != null) {
                    sb.append(", rootCommentId=").append(m.rootCommentId());
                }
                sb.append("]");
            }
            if (m.excerpt() != null && !m.excerpt().isBlank()) {
                sb.append(" 摘要: ").append(truncate(m.excerpt(), 120));
            }
            sb.append("\n");
        }
        return sb.toString().trim();
    }

    private String execListMyCommunities(AiToolContext ctx) {
        Result<CommunityClient.CommunityPageRow> res = communityClient.userCommunities(ctx.userId(), 30);
        List<CommunityClient.CommunitySummaryRow> items =
                (res != null && res.getData() != null && res.getData().items() != null)
                        ? res.getData().items() : List.of();
        if (items.isEmpty()) {
            return "你尚未加入任何社群。";
        }
        StringBuilder sb = new StringBuilder();
        for (CommunityClient.CommunitySummaryRow c : items) {
            sb.append("- ").append(c.name()).append(" (communityId=").append(c.id())
                    .append(", 成员数=").append(c.memberCount()).append(")");
            if (c.description() != null && !c.description().isBlank()) {
                sb.append(": ").append(truncate(c.description(), 80));
            }
            sb.append("\n");
        }
        return sb.toString().trim();
    }

    private String execListCommunities() {
        Result<CommunityClient.CommunityPageRow> res = communityClient.listCommunities(30);
        List<CommunityClient.CommunitySummaryRow> items =
                (res != null && res.getData() != null && res.getData().items() != null)
                        ? res.getData().items() : List.of();
        if (items.isEmpty()) {
            return "全站暂无社群。";
        }
        StringBuilder sb = new StringBuilder();
        for (CommunityClient.CommunitySummaryRow c : items) {
            sb.append("- ").append(c.name()).append(" (communityId=").append(c.id())
                    .append(", 成员数=").append(c.memberCount()).append(")");
            if (c.description() != null && !c.description().isBlank()) {
                sb.append(": ").append(truncate(c.description(), 80));
            }
            sb.append("\n");
        }
        return sb.toString().trim();
    }

    private String execListMyFavorites(JsonNode args, AiToolContext ctx) {
        int limit = clamp(args.path("limit").asInt(20), 1, 30);
        Result<PageResult<InteractionClient.FavoriteRow>> favRes =
                interactionClient.listFavorites(ctx.userId(), limit);
        List<InteractionClient.FavoriteRow> favs =
                (favRes != null && favRes.getData() != null && favRes.getData().items() != null)
                        ? favRes.getData().items() : List.of();
        if (favs.isEmpty()) {
            return "你还没有收藏任何帖子。";
        }

        List<String> postIds = favs.stream().map(InteractionClient.FavoriteRow::postId).distinct().toList();
        List<ContentClient.PostSummaryRow> posts = batchPosts(postIds);
        if (posts.isEmpty()) {
            return "你收藏的帖子可能已被删除。";
        }
        Map<String, String> commNames = batchCommunities(
                posts.stream().map(ContentClient.PostSummaryRow::communityId).distinct().toList());
        Map<String, String> authorNicks = batchNicknames(
                posts.stream().map(ContentClient.PostSummaryRow::authorId).distinct().toList());

        StringBuilder sb = new StringBuilder();
        for (ContentClient.PostSummaryRow p : posts) {
            String cname = commNames.getOrDefault(p.communityId(), "");
            String anick = authorNicks.getOrDefault(p.authorId(), "");
            int n = ctx.registerCitation(p.id(), p.title(), cname, anick);
            sb.append("[").append(n).append("] 《").append(safe(p.title())).append("》")
                    .append(" (postId=").append(p.id())
                    .append(", 社群=").append(cname)
                    .append(", 作者=").append(anick).append(")\n");
        }
        return sb.toString().trim();
    }

    private String execProposeCreatePost(JsonNode args, AiToolContext ctx,
                                         Consumer<ActionProposalView> onAction) throws Exception {
        String communityId = textOrNull(args, "communityId");
        String communityName = textOrNull(args, "communityName");
        String title = textOrNull(args, "title");
        String body = textOrNull(args, "body");
        if (communityId == null || title == null || body == null) {
            return "缺少发帖必填字段（communityId/title/body）。";
        }
        if (communityName == null || communityName.isBlank()) {
            communityName = resolveCommunityName(communityId);
        }

        List<Map<String, String>> communities = new ArrayList<>();
        try {
            Result<CommunityClient.CommunityPageRow> res = communityClient.userCommunities(ctx.userId(), 30);
            if (res != null && res.getData() != null && res.getData().items() != null) {
                for (CommunityClient.CommunitySummaryRow c : res.getData().items()) {
                    communities.add(Map.of("id", c.id(), "name", c.name()));
                }
            }
        } catch (Exception ignored) {
            // 降级：仅保留目标社群
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("communityId", communityId);
        payload.put("communityName", communityName);
        payload.put("title", truncate(title, 120));
        payload.put("body", truncate(body, 20000));
        payload.put("communities", communities);

        ActionProposalView view = saveAndEmitAction(AiAction.TYPE_CREATE_POST, payload, ctx, onAction);
        return "已生成发帖确认卡（actionId=" + view.actionId() + "），等待用户在前端核对并确认发布。";
    }

    private String execProposeFavoritePosts(JsonNode args, AiToolContext ctx,
                                            Consumer<ActionProposalView> onAction) throws Exception {
        JsonNode idsNode = args.path("postIds");
        if (!idsNode.isArray() || idsNode.isEmpty()) {
            return "未提供待收藏的 postIds。";
        }
        List<String> postIds = new ArrayList<>();
        for (JsonNode n : idsNode) {
            if (n.isTextual() || n.isNumber()) {
                String s = n.asText().trim();
                if (!s.isEmpty() && postIds.size() < 20) {
                    postIds.add(s);
                }
            }
        }
        if (postIds.isEmpty()) {
            return "未提供有效的 postIds。";
        }

        List<ContentClient.PostSummaryRow> posts = batchPosts(postIds);
        Map<String, String> commNames = batchCommunities(
                posts.stream().map(ContentClient.PostSummaryRow::communityId).distinct().toList());
        List<Map<String, String>> items = new ArrayList<>(posts.size());
        for (ContentClient.PostSummaryRow p : posts) {
            items.add(Map.of(
                    "postId", p.id(),
                    "title", safe(p.title()),
                    "communityName", commNames.getOrDefault(p.communityId(), "")
            ));
        }
        if (items.isEmpty()) {
            for (String pid : postIds) {
                items.add(Map.of("postId", pid, "title", "帖子 #" + pid, "communityName", ""));
            }
        }

        Map<String, Object> payload = Map.of("items", items);
        ActionProposalView view = saveAndEmitAction(AiAction.TYPE_FAVORITE_POSTS, payload, ctx, onAction);
        return "已生成批量收藏确认卡（actionId=" + view.actionId() + "，共 " + items.size() + " 篇），等待用户勾选确认。";
    }

    private String execProposeFollowUser(JsonNode args, AiToolContext ctx,
                                         Consumer<ActionProposalView> onAction) throws Exception {
        String targetUserId = textOrNull(args, "targetUserId");
        if (targetUserId == null) {
            return "缺少 targetUserId。";
        }
        String nickname = resolveUserNickname(targetUserId);
        Map<String, Object> payload = Map.of("targetUserId", targetUserId, "targetNickname", nickname);
        ActionProposalView view = saveAndEmitAction(AiAction.TYPE_FOLLOW_USER, payload, ctx, onAction);
        return "已生成关注确认卡（actionId=" + view.actionId() + "），等待用户确认。";
    }

    private String execProposeJoinCommunity(JsonNode args, AiToolContext ctx,
                                            Consumer<ActionProposalView> onAction) throws Exception {
        String communityName = textOrNull(args, "communityName");
        if (communityName == null) {
            return "缺少 communityName。";
        }
        Map<String, Object> payload = Map.of("communityName", communityName);
        ActionProposalView view = saveAndEmitAction(AiAction.TYPE_JOIN_COMMUNITY, payload, ctx, onAction);
        return "已生成加入社群确认卡（actionId=" + view.actionId() + "），等待用户确认。";
    }

    private String execProposeUpdateNickname(JsonNode args, AiToolContext ctx,
                                             Consumer<ActionProposalView> onAction) throws Exception {
        String nickname = textOrNull(args, "nickname");
        if (nickname == null || nickname.length() < 2 || nickname.length() > 32) {
            return "昵称长度必须在 2~32 字之间。";
        }
        Map<String, Object> payload = Map.of("nickname", nickname);
        ActionProposalView view = saveAndEmitAction(AiAction.TYPE_UPDATE_NICKNAME, payload, ctx, onAction);
        return "已生成修改昵称确认卡（actionId=" + view.actionId() + "），等待用户确认。";
    }

    private String execProposeUpdateAvatar(JsonNode args, AiToolContext ctx,
                                           Consumer<ActionProposalView> onAction) throws Exception {
        String avatarUrl = args.has("avatarUrl") && args.get("avatarUrl").isTextual()
                ? args.get("avatarUrl").asText().trim() : null;
        if (avatarUrl == null || (!avatarUrl.isEmpty() && !avatarUrl.matches("^https?://.+"))) {
            return "头像链接必须为空字符串或 http(s) 链接。";
        }
        Map<String, Object> payload = Map.of("avatarUrl", avatarUrl);
        ActionProposalView view = saveAndEmitAction(AiAction.TYPE_UPDATE_AVATAR, payload, ctx, onAction);
        return "已生成修改头像确认卡（actionId=" + view.actionId() + "），等待用户确认。";
    }

    private ActionProposalView saveAndEmitAction(String type, Map<String, Object> payload,
                                                 AiToolContext ctx,
                                                 Consumer<ActionProposalView> onAction) throws Exception {
        LocalDateTime expiresAt = LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS)
                .plusMinutes(props.getActionTtlMinutes());
        AiAction action = new AiAction();
        action.setConversationId(ctx.conversationId());
        action.setMessageId(ctx.messageId());
        action.setUserId(ctx.userId());
        action.setType(type);
        action.setPayload(objectMapper.writeValueAsString(payload));
        action.setStatus(AiAction.STATUS_PROPOSED);
        action.setExpiresAt(expiresAt);
        actionMapper.insert(action);

        ActionProposalView view = new ActionProposalView(
                String.valueOf(action.getId()),
                type,
                payload,
                AiAction.STATUS_PROPOSED,
                null,
                expiresAt);
        ctx.addAction(view);
        if (onAction != null) {
            onAction.accept(view);
        }
        return view;
    }

    public Map<String, Object> parseJsonMap(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return null;
        }
    }

    private String resolveCommunityName(String communityIdStr) {
        Long id = parseLong(communityIdStr);
        if (id == null) return "未知社群";
        try {
            Result<CommunityClient.CommunityRefRow> res = communityClient.getById(id);
            if (res != null && res.getData() != null && res.getData().exists() && res.getData().name() != null) {
                return res.getData().name();
            }
        } catch (Exception ignored) {
            // fallback
        }
        return "未知社群";
    }

    private String resolveUserNickname(String userIdStr) {
        if (userIdStr == null || userIdStr.isBlank()) return "用户";
        Map<String, String> map = batchNicknames(List.of(userIdStr));
        return map.getOrDefault(userIdStr, "用户");
    }

    private Map<String, String> batchNicknames(List<String> ids) {
        Map<String, String> map = new HashMap<>();
        if (ids == null || ids.isEmpty()) return map;
        try {
            Result<List<UserClient.UserNameRow>> res = userClient.batch(new UserClient.BatchUsersReq(ids));
            if (res != null && res.getData() != null) {
                for (UserClient.UserNameRow u : res.getData()) {
                    map.put(u.id(), u.nickname());
                }
            }
        } catch (Exception ignored) {
            // fallback
        }
        return map;
    }

    private Map<String, String> batchCommunities(List<String> ids) {
        Map<String, String> map = new HashMap<>();
        if (ids == null || ids.isEmpty()) return map;
        try {
            Result<List<CommunityClient.CommunityNameRow>> res =
                    communityClient.batch(new CommunityClient.BatchCommunitiesReq(ids));
            if (res != null && res.getData() != null) {
                for (CommunityClient.CommunityNameRow c : res.getData()) {
                    map.put(c.id(), c.name());
                }
            }
        } catch (Exception ignored) {
            // fallback
        }
        return map;
    }

    private List<ContentClient.PostSummaryRow> batchPosts(List<String> postIds) {
        if (postIds == null || postIds.isEmpty()) return List.of();
        try {
            Result<List<ContentClient.PostSummaryRow>> res =
                    contentClient.batchPosts(new ContentClient.BatchPostsReq(postIds));
            return res != null && res.getData() != null ? res.getData() : List.of();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static String wrap(String inner) {
        return "<tool_result>\n" + inner + "\n</tool_result>";
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode child = node.path(field);
        if (!child.isTextual() && !child.isNumber()) return null;
        String v = child.asText().trim();
        return v.isEmpty() ? null : v;
    }

    private static Long parseLong(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return Long.valueOf(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int clamp(int val, int min, int max) {
        return Math.max(min, Math.min(max, val));
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }
}
