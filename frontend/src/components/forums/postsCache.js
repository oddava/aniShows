import { forumKeys } from '../../api/queries/forums';

/**
 * Helpers for the cached reply payloads of one thread. Every page
 * (`forumKeys.posts`) and every "Continue this thread" subtree
 * (`forumKeys.postSubtree`) lives under `forumKeys.postsAll(threadId)`, so a
 * post is patched wherever it is shown.
 */
export function patchCachedPosts(queryClient, threadId, postId, patch) {
    queryClient.setQueriesData({ queryKey: forumKeys.postsAll(threadId) }, (old) => {
        if (!old?.results) return old;
        let changed = false;
        const results = old.results.map((post) => {
            if (post.id !== postId) return post;
            changed = true;
            return { ...post, ...(typeof patch === 'function' ? patch(post) : patch) };
        });
        return changed ? { ...old, results } : old;
    });
}

export function findCachedPost(queryClient, threadId, postId) {
    const entries = queryClient.getQueriesData({ queryKey: forumKeys.postsAll(threadId) });
    for (const [, data] of entries) {
        const found = data?.results?.find((post) => post.id === postId);
        if (found) return found;
    }
    return undefined;
}

export async function snapshotPosts(queryClient, threadId) {
    await queryClient.cancelQueries({ queryKey: forumKeys.postsAll(threadId) });
    return queryClient.getQueriesData({ queryKey: forumKeys.postsAll(threadId) });
}

export function restorePosts(queryClient, snapshot) {
    snapshot?.forEach(([key, data]) => queryClient.setQueryData(key, data));
}
