package top.katzenyasax.kuaikan.search.chunk;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Markdown 感知切片器（P9.0）。
 *
 * <p>优先按一级至三级 Markdown 标题与空行分段，合并至目标约 400 字（硬上限 480 字），
 * 相邻切片保留约 80 字重叠，且每片统一前置 {@code 标题：{title}\n}，以保证长文跨段落时的语义完整性。
 */
@Component
public class MarkdownChunker {

    private static final int TARGET_CHARS = 400;
    private static final int MAX_CHARS = 480;
    private static final int OVERLAP_CHARS = 80;
    private static final Pattern SPLIT_PATTERN = Pattern.compile("\\n(?=#{1,3}\\s)|\\n\\s*\\n+");

    public record Chunk(int index, String text) {
    }

    public List<Chunk> chunk(String title, String body) {
        String safeTitle = title == null ? "" : title.strip();
        String prefix = safeTitle.isEmpty() ? "" : ("标题：" + safeTitle + "\n");
        String normalizedBody = body == null ? "" : body.replace("\r\n", "\n").strip();

        if (normalizedBody.isEmpty()) {
            return List.of(new Chunk(0, prefix.isEmpty() ? "" : prefix.strip()));
        }

        List<String> segments = splitAndCap(normalizedBody);
        List<String> bodyChunks = mergeWithOverlap(segments);

        List<Chunk> result = new ArrayList<>(bodyChunks.size());
        for (int i = 0; i < bodyChunks.size(); i++) {
            result.add(new Chunk(i, prefix + bodyChunks.get(i)));
        }
        return result;
    }

    private List<String> splitAndCap(String text) {
        String[] rawParts = SPLIT_PATTERN.split(text);
        List<String> out = new ArrayList<>();
        for (String raw : rawParts) {
            String part = raw.strip();
            if (part.isEmpty()) {
                continue;
            }
            if (part.length() <= MAX_CHARS) {
                out.add(part);
            } else {
                sliceLongSegment(part, out);
            }
        }
        return out;
    }

    private static void sliceLongSegment(String segment, List<String> out) {
        int start = 0;
        int len = segment.length();
        while (start < len) {
            int end = Math.min(len, start + TARGET_CHARS);
            if (end < len) {
                int boundary = findSentenceBoundary(segment, start + TARGET_CHARS / 2, Math.min(len, start + MAX_CHARS));
                if (boundary > start) {
                    end = boundary;
                }
            }
            String piece = segment.substring(start, end).strip();
            if (!piece.isEmpty()) {
                out.add(piece);
            }
            if (end >= len) {
                break;
            }
            int nextStart = Math.max(start + 1, end - OVERLAP_CHARS);
            start = nextStart;
        }
    }

    private static int findSentenceBoundary(String text, int minPos, int maxPos) {
        for (int i = maxPos - 1; i >= minPos; i--) {
            char c = text.charAt(i);
            if (c == '。' || c == '！' || c == '？' || c == '；' || c == '\n'
                    || c == '.' || c == '!' || c == '?') {
                return i + 1;
            }
        }
        return -1;
    }

    private static List<String> mergeWithOverlap(List<String> segments) {
        List<String> chunks = new ArrayList<>();
        StringBuilder current = new StringBuilder();

        for (String seg : segments) {
            if (current.isEmpty()) {
                current.append(seg);
                continue;
            }
            if (current.length() + 2 + seg.length() <= TARGET_CHARS) {
                current.append("\n\n").append(seg);
                continue;
            }
            String finished = current.toString().strip();
            chunks.add(finished);
            String overlap = tailOverlap(finished);
            current.setLength(0);
            if (!overlap.isEmpty() && overlap.length() + 2 + seg.length() <= MAX_CHARS) {
                current.append(overlap).append("\n\n").append(seg);
            } else {
                current.append(seg);
            }
        }
        if (!current.isEmpty()) {
            chunks.add(current.toString().strip());
        }
        return chunks;
    }

    private static String tailOverlap(String text) {
        if (text.length() <= OVERLAP_CHARS) {
            return text;
        }
        return text.substring(text.length() - OVERLAP_CHARS).stripLeading();
    }
}
