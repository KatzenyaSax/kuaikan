package top.katzenyasax.kuaikan.community.web.dto;

import java.util.List;

/**
 * 历代管理员。**不分页**：受"单一管理员制 + 转让是低频人工操作"约束，
 * 一个社群的任数量级是个位数，分页只会让前端多一层无意义的加载状态。
 */
public record AdminHistoryView(List<AdminTermView> items) {
}
