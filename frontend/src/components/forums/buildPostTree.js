/**
 * Build the reply tree from a flat page of posts. A reply whose parent is not
 * on this page becomes a root. With `focusedPostId` set ("Continue this
 * thread") that post is returned as the only root.
 */
export default function buildPostTree(posts, focusedPostId) {
    if (!posts) return [];

    const postMap = new Map();
    const roots = [];

    // First pass: create map
    posts.forEach(post => {
        postMap.set(post.id, { ...post, replies: [] });
    });

    // Second pass: build tree
    posts.forEach(post => {
        const node = postMap.get(post.id);
        if (post.parent) {
            const parent = postMap.get(post.parent);
            if (parent) {
                parent.replies.push(node);
            } else {
                // Parent not in this page, treat as root
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    });

    // If we have a focused post, find it and return it as the ONLY root
    if (focusedPostId && postMap.has(focusedPostId)) {
        return [postMap.get(focusedPostId)];
    }

    return roots;
}
