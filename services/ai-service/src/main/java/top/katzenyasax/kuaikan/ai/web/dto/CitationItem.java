package top.katzenyasax.kuaikan.ai.web.dto;

public record CitationItem(
        int n,
        String postId,
        String noteId,
        String sourceType,
        String title,
        String communityName,
        String authorNickname
) {
    public CitationItem {
        if (sourceType == null || sourceType.isBlank()) {
            sourceType = (noteId != null && !noteId.isBlank()) ? "NOTE" : "POST";
        }
    }

    public CitationItem(int n, String postId, String title, String communityName, String authorNickname) {
        this(n, postId, null, "POST", title, communityName, authorNickname);
    }
}
