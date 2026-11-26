package top.katzenyasax.kuaikan.ai.llm;

import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 确定性测试 Stub 实现，仅在 stub-enabled=true 且内网直连带 X-AI-Stub 时由 LlmRouter 选中。
 */
@Component
public class StubLlmClient implements LlmClient {

    private static final Pattern KW_PATTERN = Pattern.compile("kw=([^\\s]+)");
    private static final Pattern POST_ID_PATTERN = Pattern.compile("postId=(\\d+)");
    private static final Pattern POST_IDS_PATTERN = Pattern.compile("postIds=([0-9,]+)");
    private static final Pattern COMMUNITY_ID_PATTERN = Pattern.compile("communityId=(\\d+)");
    private static final Pattern COMMUNITY_NAME_PATTERN = Pattern.compile("communityName=([^\\s]+)");
    private static final Pattern TARGET_USER_PATTERN = Pattern.compile("targetUserId=(\\d+)");
    private static final Pattern NICKNAME_PATTERN = Pattern.compile("nickname=([^\\s]+)");
    private static final Pattern AVATAR_PATTERN = Pattern.compile("avatarUrl=([^\\s]+)");

    @Override
    public Flux<LlmStreamChunk> streamChat(LlmChatRequest request, String stubScenario) {
        String scenario = stubScenario == null ? "" : stubScenario.trim();
        if ("error".equalsIgnoreCase(scenario)) {
            return Flux.error(new BizException(AiErrorCode.AI_UNAVAILABLE));
        }

        int toolsSinceLastUser = countToolsAfterLastUser(request.messages());
        String lastUser = lastMessageContent(request.messages(), "user");
        String systemJoined = joinSystemMessages(request.messages());
        boolean forceNoTool = "none".equalsIgnoreCase(request.toolChoice());

        if ("slow".equalsIgnoreCase(scenario)) {
            return streamText("正在慢速生成回复请稍候", 4, 700, 15, 25);
        }

        if ("compose".equalsIgnoreCase(scenario)) {
            return streamText("【AI 润色建议】结构已精简优化，观点更聚焦，可直接替换或插入当前草稿。", 8, 20, 20, 32);
        }

        if ("action_followup".equalsIgnoreCase(scenario)) {
            if (lastUser.contains("41004")) {
                return streamText("你尚未加入该社群，发帖被拦截。需要先为你提议加入该社群吗？", 8, 15, 18, 28);
            }
            if (lastUser.contains("EXECUTED")) {
                return streamText("操作已确认并执行成功！如有需要可以继续告诉我。", 8, 15, 18, 22);
            }
            if (lastUser.contains("REJECTED")) {
                return streamText("好的，已取消该操作提议。", 8, 15, 14, 16);
            }
            return streamText("已记录本次执行结果。", 8, 15, 12, 12);
        }

        if ("infinite_tools".equalsIgnoreCase(scenario)) {
            if (!forceNoTool) {
                String callId = "call_inf_" + toolsSinceLastUser;
                return singleToolCall(callId, "search_posts", "{\"limit\":2}");
            }
            return streamText("已达到工具调用步数上限，直接基于既有结果为你总结收尾。", 8, 15, 30, 24);
        }

        if ("search_citation".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String kw = extract(KW_PATTERN, lastUser, "");
                return singleToolCall("call_search_1", "search_posts",
                        "{\"keyword\":\"" + escapeJson(kw) + "\",\"limit\":5}");
            }
            return streamText("根据站内检索结果，相关帖子给出了明确讨论 [^1]（另附测试无效角标 [^9]）。", 8, 15, 45, 36);
        }

        if ("summarize_post".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String postId = extract(POST_ID_PATTERN, systemJoined + " " + lastUser, "0");
                LlmStreamChunk tc0 = new LlmStreamChunk(null,
                        List.of(new LlmToolCallDelta(0, "call_post_1", "get_post", "{\"postId\":\"" + postId + "\"}")),
                        null, null, null);
                LlmStreamChunk tc1 = new LlmStreamChunk(null,
                        List.of(new LlmToolCallDelta(1, "call_cmt_1", "get_comments", "{\"postId\":\"" + postId + "\"}")),
                        "tool_calls", 25, 15);
                return Flux.just(tc0, tc1);
            }
            return streamText("省流总结：帖子与热门评论的核心观点已提炼完毕 [^1]。", 8, 15, 50, 30);
        }

        if ("unread_summary".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                return singleToolCall("call_unread_1", "list_unread_messages", "{}");
            }
            String toolContent = lastMessageContent(request.messages(), "tool");
            String hint = toolContent.contains("暂无未读消息")
                    ? "当前暂无未读消息。"
                    : "未读消息速览：已汇总你的待处理互动，建议回复「收到，谢谢你的分享！」";
            return streamText(hint, 8, 15, 35, 28);
        }

        if ("propose_post".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String cid = extract(COMMUNITY_ID_PATTERN, lastUser, "0");
                String args = "{\"communityId\":\"" + cid + "\",\"title\":\"AI 提议测试帖\",\"body\":\"由确认卡受控提交的正文内容。\"}";
                return singleToolCall("call_prop_post", "propose_create_post", args);
            }
            return streamText("我已为你草拟发帖内容，请在确认卡核对并确认发布。", 8, 15, 30, 22);
        }

        if ("propose_favorites".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String rawIds = extract(POST_IDS_PATTERN, lastUser, "");
                StringBuilder arr = new StringBuilder("[");
                if (!rawIds.isEmpty()) {
                    String[] parts = rawIds.split(",");
                    for (int i = 0; i < parts.length; i++) {
                        if (i > 0) arr.append(",");
                        arr.append("\"").append(parts[i].trim()).append("\"");
                    }
                }
                arr.append("]");
                return singleToolCall("call_prop_fav", "propose_favorite_posts", "{\"postIds\":" + arr + "}");
            }
            return streamText("已为你列出推荐收藏帖子，请勾选需要收藏的条目并确认。", 8, 15, 28, 24);
        }

        if ("propose_follow".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String uid = extract(TARGET_USER_PATTERN, lastUser, "0");
                return singleToolCall("call_prop_follow", "propose_follow_user", "{\"targetUserId\":\"" + uid + "\"}");
            }
            return streamText("请确认是否关注该用户。", 8, 15, 20, 14);
        }

        if ("propose_join".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String cname = extract(COMMUNITY_NAME_PATTERN, lastUser, "general");
                return singleToolCall("call_prop_join", "propose_join_community",
                        "{\"communityName\":\"" + escapeJson(cname) + "\"}");
            }
            return streamText("请确认是否加入该社群。", 8, 15, 20, 14);
        }

        if ("propose_nickname".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String nick = extract(NICKNAME_PATTERN, lastUser, "新昵称");
                return singleToolCall("call_prop_nick", "propose_update_nickname",
                        "{\"nickname\":\"" + escapeJson(nick) + "\"}");
            }
            return streamText("请确认是否将昵称修改为目标名称。", 8, 15, 20, 16);
        }

        if ("propose_avatar".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String url = extract(AVATAR_PATTERN, lastUser, "https://example.com/avatar.png");
                return singleToolCall("call_prop_avatar", "propose_update_avatar",
                        "{\"avatarUrl\":\"" + escapeJson(url) + "\"}");
            }
            return streamText("请确认是否更新头像链接。", 8, 15, 20, 16);
        }

        if ("propose_profile".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                return singleToolCall("call_prop_profile", "propose_save_profile",
                        "{\"category\":\"PREFERENCE\",\"content\":\"偏好简洁带代码的 Java 技术回答\"}");
            }
            return streamText("已为你准备个人档案确认卡，确认后将长期记住这条偏好。", 8, 15, 22, 20);
        }

        if ("profile_echo".equalsIgnoreCase(scenario)) {
            String marker = "【用户个人 AI 档案";
            int idx = systemJoined.indexOf(marker);
            String injected = idx >= 0 ? systemJoined.substring(idx).split("\n\n")[0].replace('\n', ' ') : "无档案条目";
            return streamText("[profile] " + injected, 12, 10, 20, 20);
        }

        if ("search_my_kb".equalsIgnoreCase(scenario)) {
            if (toolsSinceLastUser == 0 && !forceNoTool) {
                String kw = extract(KW_PATTERN, lastUser, "笔记");
                return singleToolCall("call_my_kb", "search_my_knowledge",
                        "{\"query\":\"" + escapeJson(kw) + "\"}");
            }
            String toolContent = lastMessageContent(request.messages(), "tool");
            if (toolContent.contains("暂未找到") || toolContent.contains("暂不可用")) {
                return streamText("个人知识库未命中：" + toolContent.replaceAll("</?tool_result>", "").trim(), 12, 10, 20, 24);
            }
            return streamText("已在你的个人知识库中找到匹配内容 [^1]。", 10, 10, 24, 20);
        }

        if ("scope_check".equalsIgnoreCase(scenario)) {
            boolean hasSearchPosts = request.tools() != null && request.tools().stream()
                    .anyMatch(t -> t.get("function") instanceof java.util.Map<?, ?> fn
                            && "search_posts".equals(fn.get("name")));
            return streamText("[scope] search_posts=" + hasSearchPosts, 12, 10, 15, 16);
        }

        String reply = "[stub:" + scenario + "] 收到消息：" + lastUser;
        return streamText(reply, 6, 30, 12, Math.max(1, reply.length()));
    }

    private Flux<LlmStreamChunk> singleToolCall(String id, String name, String argsJson) {
        int mid = Math.max(1, argsJson.length() / 2);
        LlmStreamChunk c1 = new LlmStreamChunk(null,
                List.of(new LlmToolCallDelta(0, id, name, argsJson.substring(0, mid))),
                null, null, null);
        LlmStreamChunk c2 = new LlmStreamChunk(null,
                List.of(new LlmToolCallDelta(0, null, null, argsJson.substring(mid))),
                "tool_calls", 20, 12);
        return Flux.just(c1, c2);
    }

    private Flux<LlmStreamChunk> streamText(String reply, int chunkSize, long delayMs, int pTok, int cTok) {
        List<String> parts = splitChunks(reply, chunkSize);
        Flux<LlmStreamChunk> textFlux = Flux.fromIterable(parts)
                .delayElements(Duration.ofMillis(delayMs))
                .map(p -> new LlmStreamChunk(p, List.of(), null, null, null));
        LlmStreamChunk tail = new LlmStreamChunk(null, List.of(), "stop", pTok, cTok);
        return textFlux.concatWithValues(tail);
    }

    private int countToolsAfterLastUser(List<LlmMessage> msgs) {
        int lastUserIdx = -1;
        for (int i = 0; i < msgs.size(); i++) {
            if ("user".equals(msgs.get(i).role())) {
                lastUserIdx = i;
            }
        }
        int count = 0;
        for (int i = lastUserIdx + 1; i < msgs.size(); i++) {
            if ("tool".equals(msgs.get(i).role())) {
                count++;
            }
        }
        return count;
    }

    private String lastMessageContent(List<LlmMessage> msgs, String role) {
        for (int i = msgs.size() - 1; i >= 0; i--) {
            if (role.equals(msgs.get(i).role()) && msgs.get(i).content() != null) {
                return msgs.get(i).content();
            }
        }
        return "";
    }

    private String joinSystemMessages(List<LlmMessage> msgs) {
        StringBuilder sb = new StringBuilder();
        for (LlmMessage m : msgs) {
            if ("system".equals(m.role()) && m.content() != null) {
                sb.append(m.content()).append('\n');
            }
        }
        return sb.toString();
    }

    private String extract(Pattern p, String text, String fallback) {
        if (text == null) return fallback;
        Matcher m = p.matcher(text);
        return m.find() ? m.group(1) : fallback;
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private List<String> splitChunks(String text, int chunkSize) {
        if (text.isEmpty()) {
            return List.of(" ");
        }
        int count = (text.length() + chunkSize - 1) / chunkSize;
        List<String> out = new ArrayList<>(count);
        for (int i = 0; i < text.length(); i += chunkSize) {
            out.add(text.substring(i, Math.min(text.length(), i + chunkSize)));
        }
        return out;
    }
}
