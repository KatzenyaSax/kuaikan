package top.katzenyasax.kuaikan.ai.tool;

import top.katzenyasax.kuaikan.ai.web.dto.ActionProposalView;
import top.katzenyasax.kuaikan.ai.web.dto.CitationItem;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 单轮对话内的工具执行上下文：维护引用白名单与写提议收集列表。
 */
public class AiToolContext {

    private final Long userId;
    private final Long conversationId;
    private final Long messageId;
    private final Map<String, CitationItem> byPostId = new LinkedHashMap<>();
    private final Map<Integer, CitationItem> byIndex = new LinkedHashMap<>();
    private final List<ActionProposalView> proposedActions = new ArrayList<>();

    public AiToolContext(Long userId, Long conversationId, Long messageId) {
        this.userId = userId;
        this.conversationId = conversationId;
        this.messageId = messageId;
    }

    public Long userId() { return userId; }
    public Long conversationId() { return conversationId; }
    public Long messageId() { return messageId; }

    public int registerCitation(String postId, String title, String communityName, String authorNickname) {
        if (postId == null || postId.isBlank()) {
            return -1;
        }
        CitationItem existing = byPostId.get(postId);
        if (existing != null) {
            return existing.n();
        }
        int nextN = byIndex.size() + 1;
        CitationItem item = new CitationItem(
                nextN,
                postId,
                title != null ? title : "无标题",
                communityName != null ? communityName : "",
                authorNickname != null ? authorNickname : "");
        byPostId.put(postId, item);
        byIndex.put(nextN, item);
        return nextN;
    }

    public CitationItem getCitationByIndex(int n) {
        return byIndex.get(n);
    }

    public List<CitationItem> allCitations() {
        return List.copyOf(byIndex.values());
    }

    public void addAction(ActionProposalView action) {
        proposedActions.add(action);
    }

    public List<ActionProposalView> proposedActions() {
        return List.copyOf(proposedActions);
    }
}
