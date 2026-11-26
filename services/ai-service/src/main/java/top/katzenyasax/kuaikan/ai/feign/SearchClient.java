package top.katzenyasax.kuaikan.ai.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

import java.util.List;

@FeignClient(name = Services.SEARCH)
public interface SearchClient {

    @PostMapping("/internal/search/posts")
    Result<PageResult<SearchPostRow>> searchPosts(@RequestBody SearchPostsReq request);

    @PostMapping("/internal/search/notes")
    Result<List<SearchNoteRow>> searchNotes(@RequestBody SearchNotesReq request);

    record SearchPostsReq(
            String keyword,
            String authorId,
            String authorNickname,
            String communityId,
            String communityName,
            String createdFrom,
            String createdTo,
            String sort,
            String cursor,
            Integer limit,
            Boolean includeBody,
            String mode,
            List<String> postIds
    ) {
        public SearchPostsReq(String keyword, String authorId, String authorNickname,
                              String communityId, String communityName, String createdFrom,
                              String createdTo, String sort, String cursor,
                              Integer limit, Boolean includeBody) {
            this(keyword, authorId, authorNickname, communityId, communityName, createdFrom,
                    createdTo, sort, cursor, limit, includeBody, null, null);
        }
    }

    record SearchPostRow(
            String postId,
            String communityId,
            String communityName,
            String authorId,
            String authorNickname,
            String title,
            String body,
            String excerpt,
            long createdAt
    ) {}

    record SearchNotesReq(
            String ownerId,
            String query,
            Integer limit
    ) {}

    record SearchNoteRow(
            String noteId,
            String title,
            String snippet,
            double score,
            long updatedAt
    ) {}
}
