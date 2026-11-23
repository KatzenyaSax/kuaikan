package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

/**
 * 编辑社群信息（{@code PUT /communities/{name}}，仅管理员）。
 *
 * **名称不在这里**：`name` / `name_key` 已经是 URL 与消息/搜索快照的一部分，
 * 改名等于让所有旧链接失效（p7-community-admin.md §1.1）。
 *
 * 三个字段的 null / 空串语义**刻意不同**，前端必须按这个约定发请求：
 *   null  → 不修改（PATCH 语义，省掉"读一遍再整份提交"）
 *   ""    → 清空（写回 NULL）
 *   " xx " → trim 后写入
 *
 * 如果 null 也被当成"清空"，那么只改公告的一次请求会顺手抹掉头像——
 * 这是表单只提交了变化的字段时最容易发生的事故。
 *
 * 长度上限必须在两侧一致（这里与前端 maxLength、与 Flyway 的列宽是同一组数字）：
 * description 500 / avatarUrl 512 / announcement 1000。
 * avatarUrl 的协议白名单（只允许 http/https）在 Service 里校验 —— 那是业务规则，
 * 不是长度规则，放在这里只能得到一句没有上下文的"格式不对"。
 */
public record UpdateCommunityInfoRequest(
        @Size(max = 500, message = "简介不能超过 500 字")
        String description,

        @Size(max = 512, message = "头像链接不能超过 512 字")
        @Schema(description = "头像外链；非空时必须以 http:// 或 https:// 开头")
        String avatarUrl,

        @Size(max = 1000, message = "公告不能超过 1000 字")
        String announcement
) {
}
