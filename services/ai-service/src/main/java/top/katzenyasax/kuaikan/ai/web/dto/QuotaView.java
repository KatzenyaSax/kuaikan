package top.katzenyasax.kuaikan.ai.web.dto;

public record QuotaView(
        int dailyLimit,
        int used,
        int remaining
) {
}
