package top.katzenyasax.kuaikan.ai.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.ai.domain.AiProfileEntry;
import top.katzenyasax.kuaikan.ai.mapper.AiProfileEntryMapper;
import top.katzenyasax.kuaikan.ai.web.dto.ProfileEntryRequest;
import top.katzenyasax.kuaikan.ai.web.dto.ProfileEntryView;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 个人 AI 档案服务（P9.2）：明文条目化管理与 system prompt 最高优先级注入。
 */
@Service
public class AiProfileService {

    public static final int MAX_ENTRIES_PER_USER = 30;
    public static final int MAX_CONTENT_LENGTH = 200;
    private static final Set<String> VALID_CATEGORIES = Set.of(
            AiProfileEntry.CAT_IDENTITY,
            AiProfileEntry.CAT_PREFERENCE,
            AiProfileEntry.CAT_STYLE,
            AiProfileEntry.CAT_OTHER);

    private final AiProfileEntryMapper mapper;

    public AiProfileService(AiProfileEntryMapper mapper) {
        this.mapper = mapper;
    }

    public List<ProfileEntryView> listEntries(Long userId) {
        List<AiProfileEntry> rows = mapper.selectList(new LambdaQueryWrapper<AiProfileEntry>()
                .eq(AiProfileEntry::getUserId, userId)
                .orderByAsc(AiProfileEntry::getCategory)
                .orderByDesc(AiProfileEntry::getUpdatedAt)
                .orderByDesc(AiProfileEntry::getId));
        return rows.stream().map(ProfileEntryView::of).toList();
    }

    public ProfileEntryView createEntry(Long userId, ProfileEntryRequest req) {
        if (req == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "请求体不能为空");
        }
        String category = normalizeCategory(req.category());
        String content = normalizeContent(req.content());
        String source = AiProfileEntry.SOURCE_AI_CONFIRMED.equalsIgnoreCase(req.source())
                ? AiProfileEntry.SOURCE_AI_CONFIRMED
                : AiProfileEntry.SOURCE_MANUAL;
        int enabled = req.enabled() == null || req.enabled() ? 1 : 0;

        Long count = mapper.selectCount(new LambdaQueryWrapper<AiProfileEntry>()
                .eq(AiProfileEntry::getUserId, userId));
        if (count != null && count >= MAX_ENTRIES_PER_USER) {
            throw new BizException(AiErrorCode.AI_PROFILE_LIMIT_EXCEEDED);
        }

        AiProfileEntry entry = new AiProfileEntry();
        entry.setUserId(userId);
        entry.setCategory(category);
        entry.setContent(content);
        entry.setEnabled(enabled);
        entry.setSource(source);
        mapper.insert(entry);
        return ProfileEntryView.of(mapper.selectById(entry.getId()));
    }

    public ProfileEntryView updateEntry(Long userId, Long id, ProfileEntryRequest req) {
        if (req == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "请求体不能为空");
        }
        AiProfileEntry existing = requireOwned(userId, id);
        if (req.category() != null) {
            existing.setCategory(normalizeCategory(req.category()));
        }
        if (req.content() != null) {
            existing.setContent(normalizeContent(req.content()));
        }
        if (req.enabled() != null) {
            existing.setEnabled(req.enabled() ? 1 : 0);
        }
        mapper.updateById(existing);
        return ProfileEntryView.of(mapper.selectById(existing.getId()));
    }

    public void deleteEntry(Long userId, Long id) {
        requireOwned(userId, id);
        mapper.deleteById(id);
    }

    /** 渲染为注入 system prompt 的最高权威个人档案段落（停用条目绝不注入） */
    public String renderSystemPromptSection(Long userId) {
        if (userId == null) {
            return null;
        }
        List<AiProfileEntry> enabledRows = mapper.selectList(new LambdaQueryWrapper<AiProfileEntry>()
                .eq(AiProfileEntry::getUserId, userId)
                .eq(AiProfileEntry::getEnabled, 1)
                .orderByAsc(AiProfileEntry::getCategory)
                .orderByDesc(AiProfileEntry::getUpdatedAt));
        if (enabledRows.isEmpty()) {
            return null;
        }
        StringBuilder sb = new StringBuilder("【用户个人 AI 档案（最高权威优先级，回答与写作须优先遵循）】\n");
        for (AiProfileEntry e : enabledRows) {
            sb.append("- [").append(categoryLabel(e.getCategory())).append("] ")
                    .append(e.getContent()).append("\n");
        }
        return sb.toString().trim();
    }

    private AiProfileEntry requireOwned(Long userId, Long id) {
        AiProfileEntry entry = mapper.selectOne(new LambdaQueryWrapper<AiProfileEntry>()
                .eq(AiProfileEntry::getId, id)
                .eq(AiProfileEntry::getUserId, userId));
        if (entry == null) {
            throw new BizException(AiErrorCode.AI_PROFILE_NOT_FOUND);
        }
        return entry;
    }

    public static String normalizeCategory(String raw) {
        String cat = raw == null ? "" : raw.strip().toUpperCase(Locale.ROOT);
        if (!VALID_CATEGORIES.contains(cat)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "category 只能是 IDENTITY / PREFERENCE / STYLE / OTHER");
        }
        return cat;
    }

    public static String normalizeContent(String raw) {
        String content = raw == null ? "" : raw.strip();
        if (content.isEmpty() || content.codePointCount(0, content.length()) > MAX_CONTENT_LENGTH) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "档案内容不能为空且长度不能超过 " + MAX_CONTENT_LENGTH + " 字");
        }
        return content;
    }

    private static String categoryLabel(String cat) {
        if (cat == null) return "其他";
        return switch (cat) {
            case AiProfileEntry.CAT_IDENTITY -> "身份背景";
            case AiProfileEntry.CAT_PREFERENCE -> "技术与偏好";
            case AiProfileEntry.CAT_STYLE -> "写作风格";
            default -> "其他";
        };
    }
}
