package top.katzenyasax.kuaikan.ai.web.dto;

public record NoteUpsertRequest(
        String title,
        String content,
        Boolean enabled
) {
}
