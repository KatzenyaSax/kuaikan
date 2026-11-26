package top.katzenyasax.kuaikan.ai.web.dto;

public record ProfileEntryRequest(
        String category,
        String content,
        Boolean enabled,
        String source
) {
}
