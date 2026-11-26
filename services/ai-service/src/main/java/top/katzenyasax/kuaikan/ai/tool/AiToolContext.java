package top.katzenyasax.kuaikan.ai.tool;

import top.katzenyasax.kuaikan.ai.web.dto.ActionProposalView;
import top.katzenyasax.kuaikan.ai.web.dto.CitationItem;
import top.katzenyasax.kuaikan.ai.web.dto.PageContextDto;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 单轮对话内的工具执行上下文：维护引用白名单、检索范围、页面上下文与写提议收集列表。
 */
public class AiToolContext {

    public static final String SCOPE_ALL = "ALL";
    public static final String SCOPE_MY_ONLY = "MY_ONLY";
    public static final String SCOPE_CURRENT_COMMUNITY = "CURRENT_COMMUNITY";

    private final Long userId;
    private final Long conversationId;
    private final Long messageId;
    private final String retrievalScope;
    private final PageContextDto pageContext;
    private final Map<String, CitationItem> byKey = new LinkedHashMap<>();
    private final Map<Integer, CitationItem> byIndex = new LinkedHashMap<>();
    private final List<ActionProposalView> proposedActions = new ArrayList<>();
    private boolean profileProposedInTurn;

    public AiToolContext(Long userId, Long conversationId, Long messageId) {
        this(userId, conversationId, messageId, SCOPE_ALL, null);
    }

    public AiToolContext(Long userId, Long conversationId, Long messageId,
                         String retrievalScope, PageContextDto pageContext) {
        this.userId = userId;
        this.conversationId = conversationId;
        this.messageId = messageId;
        this.retrievalScope = normalizeScope(retrievalScope);
        this.pageContext = pageContext;
    }

    public Long userId() { return userId; }
    public Long conversationId() { return conversationId; }
    public Long messageId() { return messageId; }
    public String retrievalScope() { return retrievalScope; }
    public PageContextDto pageContext() { return pageContext; }

    public int registerCitation(String postId, String title, String communityName, String authorNickname) {
        return registerPostCitation(postId, "POST", title, communityName, authorNickname);
    }

    public int registerPostCitation(String postId, String sourceType,
                                    String title, String communityName, String authorNickname) {
        if (postId == null || postId.isBlank()) {
            return -1;
        }
        String key = "POST:" + postId;
        CitationItem existing = byKey.get(key);
        if (existing != null) {
            return existing.n();
        }
        int nextN = byIndex.size() + 1;
        CitationItem item = new CitationItem(
                nextN,
                postId,
                null,
                sourceType != null ? sourceType : "POST",
                title != null ? title : "无标题",
                communityName != null ? communityName : "",
                authorNickname != null ? authorNickname : "");
        byKey.put(key, item);
        byIndex.put(nextN, item);
        return nextN;
    }

    public int registerNoteCitation(String noteId, String title) {
        if (noteId == null || noteId.isBlank()) {
            return -1;
        }
        String key = "NOTE:" + noteId;
        CitationItem existing = byKey.get(key);
        if (existing != null) {
            return existing.n();
        }
        int nextN = byIndex.size() + 1;
        CitationItem item = new CitationItem(
                nextN,
                null,
                noteId,
                "NOTE",
                title != null ? title : "无标题笔记",
                "我的笔记",
                "");
        byKey.put(key, item);
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

    public boolean markProfileProposed() {
        if (profileProposedInTurn) {
            return false;
        }
        profileProposedInTurn = true;
        return true;
    }

    public static String normalizeScope(String raw) {
        if (raw == null || raw.isBlank()) {
            return SCOPE_ALL;
        }
        return switch (raw.strip().toUpperCase()) {
            case SCOPE_MY_ONLY -> SCOPE_MY_ONLY;
            case SCOPE_CURRENT_COMMUNITY -> SCOPE_CURRENT_COMMUNITY;
            default -> SCOPE_ALL;
        };
    }
}
