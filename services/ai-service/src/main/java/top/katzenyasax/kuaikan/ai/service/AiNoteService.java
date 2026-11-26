package top.katzenyasax.kuaikan.ai.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.ai.domain.AiNote;
import top.katzenyasax.kuaikan.ai.mapper.AiNoteMapper;
import top.katzenyasax.kuaikan.ai.web.dto.InternalNoteView;
import top.katzenyasax.kuaikan.ai.web.dto.NoteDetailView;
import top.katzenyasax.kuaikan.ai.web.dto.NoteSummaryView;
import top.katzenyasax.kuaikan.ai.web.dto.NoteUpsertRequest;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.mq.NoteChanged;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.common.outbox.OutboxEvent;
import top.katzenyasax.kuaikan.common.outbox.OutboxMapper;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 个人 Markdown 私密笔记服务（P9.3）：MySQL 持有真相，变更经 outbox 发 {@code kuaikan_note_changed}。
 */
@Service
public class AiNoteService {

    public static final int MAX_NOTES_PER_USER = 200;
    public static final int MAX_TITLE_LENGTH = 100;
    public static final int MAX_CONTENT_LENGTH = 20000;
    private static final String SORT_NOTE = "ai_note";
    private static final String SORT_INTERNAL_BATCH = "ai_note_batch";

    private final AiNoteMapper mapper;
    private final OutboxMapper outboxMapper;
    private final ObjectMapper objectMapper;

    public AiNoteService(AiNoteMapper mapper, OutboxMapper outboxMapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.outboxMapper = outboxMapper;
        this.objectMapper = objectMapper;
    }

    public PageResult<NoteSummaryView> listNotes(Long ownerId, String cursor, Integer limit) {
        int size = limit == null ? 20 : Math.max(1, Math.min(limit, 50));
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_NOTE);

        LambdaQueryWrapper<AiNote> q = new LambdaQueryWrapper<AiNote>()
                .eq(AiNote::getOwnerId, ownerId);
        if (c != null) {
            LocalDateTime ts = LocalDateTime.ofInstant(
                    Instant.ofEpochMilli(c.timestampMillis()), ZoneId.systemDefault());
            q.and(w -> w.lt(AiNote::getUpdatedAt, ts)
                    .or(o -> o.eq(AiNote::getUpdatedAt, ts).lt(AiNote::getId, c.id())));
        }
        q.orderByDesc(AiNote::getUpdatedAt)
                .orderByDesc(AiNote::getId)
                .last("LIMIT " + (size + 1));

        List<AiNote> rows = mapper.selectList(q);
        boolean hasMore = rows.size() > size;
        List<NoteSummaryView> items = new ArrayList<>(Math.min(rows.size(), size));
        for (int i = 0; i < rows.size() && i < size; i++) {
            AiNote n = rows.get(i);
            String body = n.getContent() == null ? "" : n.getContent();
            items.add(new NoteSummaryView(
                    String.valueOf(n.getId()),
                    n.getTitle(),
                    excerpt(body),
                    body.codePointCount(0, body.length()),
                    n.getEnabled() != null && n.getEnabled() == 1,
                    n.getCreatedAt(),
                    n.getUpdatedAt()));
        }
        String next = null;
        if (hasMore && !items.isEmpty()) {
            AiNote last = rows.get(size - 1);
            long millis = toMillis(last.getUpdatedAt());
            next = CursorCodec.encode(SORT_NOTE, millis, last.getId());
        }
        return PageResult.of(items, next);
    }

    public NoteDetailView getNote(Long ownerId, Long noteId) {
        return NoteDetailView.of(requireOwned(ownerId, noteId));
    }

    @Transactional
    public NoteDetailView createNote(Long ownerId, NoteUpsertRequest req) {
        if (req == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "请求体不能为空");
        }
        String title = normalizeTitle(req.title());
        String content = normalizeContent(req.content());
        int enabled = req.enabled() == null || req.enabled() ? 1 : 0;

        Long count = mapper.selectCount(new LambdaQueryWrapper<AiNote>()
                .eq(AiNote::getOwnerId, ownerId));
        if (count != null && count >= MAX_NOTES_PER_USER) {
            throw new BizException(AiErrorCode.AI_NOTE_LIMIT_EXCEEDED);
        }

        AiNote note = new AiNote();
        note.setOwnerId(ownerId);
        note.setTitle(title);
        note.setContent(content);
        note.setEnabled(enabled);
        mapper.insert(note);

        enqueueChanged(note.getId(), ownerId);
        return NoteDetailView.of(mapper.selectById(note.getId()));
    }

    @Transactional
    public NoteDetailView updateNote(Long ownerId, Long noteId, NoteUpsertRequest req) {
        if (req == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "请求体不能为空");
        }
        AiNote note = requireOwned(ownerId, noteId);
        if (req.title() != null) {
            note.setTitle(normalizeTitle(req.title()));
        }
        if (req.content() != null) {
            note.setContent(normalizeContent(req.content()));
        }
        if (req.enabled() != null) {
            note.setEnabled(req.enabled() ? 1 : 0);
        }
        mapper.updateById(note);

        enqueueChanged(note.getId(), ownerId);
        return NoteDetailView.of(mapper.selectById(note.getId()));
    }

    /** 硬删除笔记并同步投递变更事件清向量 */
    @Transactional
    public void deleteNote(Long ownerId, Long noteId) {
        requireOwned(ownerId, noteId);
        mapper.deleteById(noteId);
        enqueueChanged(noteId, ownerId);
    }

    /** 内部读接口：供 search-service 消费 kuaikan_note_changed 回查最新状态 */
    public InternalNoteView getInternalNote(Long noteId) {
        AiNote note = mapper.selectById(noteId);
        if (note == null) {
            return InternalNoteView.missing(String.valueOf(noteId));
        }
        return toInternalView(note);
    }

    /** 内部游标批量拉取：供 search-service 全量重建 note_chunk_v* */
    public PageResult<InternalNoteView> batchInternalNotes(String cursor, Integer limit) {
        int size = limit == null ? 100 : Math.max(1, Math.min(limit, 200));
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_INTERNAL_BATCH);

        LambdaQueryWrapper<AiNote> q = new LambdaQueryWrapper<AiNote>()
                .eq(AiNote::getEnabled, 1);
        if (c != null) {
            q.gt(AiNote::getId, c.id());
        }
        q.orderByAsc(AiNote::getId).last("LIMIT " + (size + 1));

        List<AiNote> rows = mapper.selectList(q);
        boolean hasMore = rows.size() > size;
        List<InternalNoteView> items = new ArrayList<>(Math.min(rows.size(), size));
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(toInternalView(rows.get(i)));
        }
        String next = null;
        if (hasMore && !items.isEmpty()) {
            AiNote last = rows.get(size - 1);
            next = CursorCodec.encode(SORT_INTERNAL_BATCH, 0L, last.getId());
        }
        return PageResult.of(items, next);
    }

    /**
     * 读侧强一致校验：拿到 ES 召回的 noteId 后回查 MySQL，过滤掉刚删除或刚停用但 MQ 尚未消费的条目。
     */
    public Set<String> filterValidOwnedNoteIds(Long ownerId, List<String> rawNoteIds) {
        if (ownerId == null || rawNoteIds == null || rawNoteIds.isEmpty()) {
            return Set.of();
        }
        List<Long> ids = new ArrayList<>(rawNoteIds.size());
        for (String s : rawNoteIds) {
            try {
                ids.add(Long.valueOf(s));
            } catch (NumberFormatException ignored) {
                // skip
            }
        }
        if (ids.isEmpty()) {
            return Set.of();
        }
        List<AiNote> validRows = mapper.selectList(new LambdaQueryWrapper<AiNote>()
                .select(AiNote::getId)
                .eq(AiNote::getOwnerId, ownerId)
                .eq(AiNote::getEnabled, 1)
                .in(AiNote::getId, ids));
        Set<String> valid = new HashSet<>(validRows.size());
        for (AiNote row : validRows) {
            valid.add(String.valueOf(row.getId()));
        }
        return valid;
    }

    private void enqueueChanged(Long noteId, Long ownerId) {
        String eventId = UUID.randomUUID().toString();
        NoteChanged event = new NoteChanged(
                eventId,
                System.currentTimeMillis(),
                String.valueOf(noteId),
                String.valueOf(ownerId));
        OutboxEvent row = new OutboxEvent();
        row.setEventId(eventId);
        row.setTopic(Topics.NOTE_CHANGED);
        try {
            row.setPayload(objectMapper.writeValueAsString(event));
        } catch (Exception e) {
            throw new IllegalStateException("序列化 NoteChanged 失败", e);
        }
        row.setStatus(OutboxEvent.STATUS_PENDING);
        row.setRetryCount(0);
        row.setNextRetryAt(LocalDateTime.now());
        outboxMapper.insert(row);
    }

    private AiNote requireOwned(Long ownerId, Long noteId) {
        AiNote note = mapper.selectOne(new LambdaQueryWrapper<AiNote>()
                .eq(AiNote::getId, noteId)
                .eq(AiNote::getOwnerId, ownerId));
        if (note == null) {
            throw new BizException(AiErrorCode.AI_NOTE_NOT_FOUND);
        }
        return note;
    }

    private InternalNoteView toInternalView(AiNote n) {
        return new InternalNoteView(
                true,
                String.valueOf(n.getId()),
                String.valueOf(n.getOwnerId()),
                n.getTitle(),
                n.getContent(),
                n.getEnabled() != null && n.getEnabled() == 1,
                toMillis(n.getUpdatedAt()));
    }

    private static String normalizeTitle(String raw) {
        String title = raw == null ? "" : raw.strip();
        if (title.isEmpty() || title.codePointCount(0, title.length()) > MAX_TITLE_LENGTH) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "笔记标题不能为空且长度不能超过 " + MAX_TITLE_LENGTH + " 字");
        }
        return title;
    }

    private static String normalizeContent(String raw) {
        String content = raw == null ? "" : raw.strip();
        if (content.isEmpty() || content.codePointCount(0, content.length()) > MAX_CONTENT_LENGTH) {
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "笔记正文不能为空且长度不能超过 " + MAX_CONTENT_LENGTH + " 字");
        }
        return content;
    }

    private static String excerpt(String content) {
        String flat = content.strip().replaceAll("\\s+", " ");
        if (flat.codePointCount(0, flat.length()) <= 140) {
            return flat;
        }
        return flat.substring(0, flat.offsetByCodePoints(0, 140)) + "…";
    }

    private static long toMillis(LocalDateTime dt) {
        if (dt == null) return System.currentTimeMillis();
        return dt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
