package top.katzenyasax.kuaikan.community.service;

import java.text.Normalizer;
import java.util.Locale;

/**
 * 社群名 → 规范化唯一键。
 *
 * 这是全项目唯一一处"名称如何变成 URL"的定义，改动必须同时考虑已有数据。
 *
 * 三步：
 *   1. **NFKC**：全角转半角。中文输入法下 "ＡＢＣ" 与 "ABC" 必须视为同名，
 *      这不是洁癖——不处理就会出现两个看起来一样的社群。
 *   2. **trim + toLowerCase**：`Frontend` 与 `frontend` 是同一个社群。
 *   3. **连续空白转 "-"**：名字里的空格不能直接进 URL 路径（会变成 %20），
 *      折成连字符后 `/c/前端-周刊` 仍然可读。
 *
 * URL 里用 name_key 查找，所以 `/c/FRONTEND` 与 `/c/frontend` 都能命中。
 */
public final class NameKeys {

    public static String of(String name) {
        if (name == null) {
            return "";
        }
        String key = Normalizer.normalize(name, Normalizer.Form.NFKC)
                .trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", "-");
        // 长度按字符算：中文一个字符可能占 3 字节，但 uk_name_key 是 VARCHAR(64)，
        // 这里再兜一层，避免规范化后变长导致插入失败
        return key.length() > 64 ? key.substring(0, 64) : key;
    }

    private NameKeys() {
    }
}
