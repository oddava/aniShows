/**
 * Build the reply tree from a flat page of posts. A reply whose parent is not
 * on this page becomes a root. With `focusedPostId` set ("Continue this
 * thread") that post is returned as the only root; this works for a normal
 * page and for the `?root=` subtree payload (whose root's parent is never in
 * the payload).
 *
 * Each node keeps the post's fields plus `replies`, and `hasHiddenReplies`
 * when the server cut its children off this payload (`has_hidden_replies`).
 */
export default function buildPostTree(posts, focusedPostId) {
    if (!Array.isArray(posts) || posts.length === 0) return [];

    const postMap = new Map();
    const roots = [];

    posts.forEach((post) => {
        postMap.set(post.id, {
            ...post,
            replies: [],
            hasHiddenReplies: Boolean(post.has_hidden_replies),
        });
    });

    posts.forEach((post) => {
        const node = postMap.get(post.id);
        const parent = post.parent != null ? postMap.get(post.parent) : null;
        if (parent && parent !== node) {
            parent.replies.push(node);
        } else {
            // Top level, or its parent is not in this payload
            roots.push(node);
        }
    });

    const focusKey = focusedPostId == null ? null : Number(focusedPostId);
    if (focusKey != null && postMap.has(focusKey)) {
        return [postMap.get(focusKey)];
    }

    return roots;
}

/**
 * Total pages of a DRF page without assuming the server's page size: the
 * last page has no `next`; otherwise the size is this page's top-level rows.
 */
export function getTotalPages(data, page, isTopLevel = () => true) {
    if (!data || !data.count) return 0;
    if (!data.next) return Math.max(1, page);
    const perPage = (data.results || []).filter(isTopLevel).length;
    if (!perPage) return page + 1;
    return Math.max(page + 1, Math.ceil(data.count / perPage));
}

export const isTopLevelPost = (post) => post.parent == null;
