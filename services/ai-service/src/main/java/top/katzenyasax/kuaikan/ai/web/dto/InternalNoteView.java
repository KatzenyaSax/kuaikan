package top.katzenyasax.kuaikan.ai.web.dto;

public record InternalNoteView(
        boolean exists,
        String noteId,
        String ownerId,
        String title,
        String content,
        boolean enabled,
        long updatedAt
) {
    public static InternalNoteView missing(String noteId) {
        return new InternalNoteView(false, noteId, null, null, null, false, 0L);
    }
}
