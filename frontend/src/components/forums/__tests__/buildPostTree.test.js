import { describe, expect, it } from 'vitest';
import buildPostTree, { getTotalPages, isTopLevelPost } from '../buildPostTree';

const POSTS = [
    { id: 1, parent: null },
    { id: 2, parent: 1 },
    { id: 3, parent: 2 },
    { id: 4, parent: 99 }, // parent on another page
    { id: 5, parent: null },
];

describe('buildPostTree', () => {
    it('returns an empty list without posts', () => {
        expect(buildPostTree(undefined, null)).toEqual([]);
        expect(buildPostTree([], 3)).toEqual([]);
    });

    it('nests replies and treats orphans as roots', () => {
        const roots = buildPostTree(POSTS, null);

        expect(roots.map((post) => post.id)).toEqual([1, 4, 5]);
        expect(roots[0].replies.map((post) => post.id)).toEqual([2]);
        expect(roots[0].replies[0].replies.map((post) => post.id)).toEqual([3]);
    });

    it('returns only the focused post when it is on the page', () => {
        expect(buildPostTree(POSTS, 2).map((post) => post.id)).toEqual([2]);
        expect(buildPostTree(POSTS, 42).map((post) => post.id)).toEqual([1, 4, 5]);
    });

    it('accepts the focused id as a string from the URL', () => {
        expect(buildPostTree(POSTS, '2').map((post) => post.id)).toEqual([2]);
    });

    it('builds the focused subtree from a ?root= payload (root parent not in the payload)', () => {
        const subtree = [
            { id: 40, parent: 39, depth: 8 },
            { id: 41, parent: 40, depth: 9 },
            { id: 42, parent: 41, depth: 10 },
            { id: 43, parent: 40, depth: 9 },
        ];
        const roots = buildPostTree(subtree, 40);

        expect(roots.map((post) => post.id)).toEqual([40]);
        expect(roots[0].replies.map((post) => post.id)).toEqual([41, 43]);
        expect(roots[0].replies[0].replies[0]).toMatchObject({ id: 42, depth: 10 });
    });

    it('flags posts whose replies were cut from the payload', () => {
        const roots = buildPostTree([
            { id: 1, parent: null, has_hidden_replies: true },
            { id: 2, parent: null },
        ], null);

        expect(roots[0].hasHiddenReplies).toBe(true);
        expect(roots[0].replies).toEqual([]);
        expect(roots[1].hasHiddenReplies).toBe(false);
    });
});

describe('getTotalPages', () => {
    const page = (topLevel, replies, { count, next }) => ({
        count,
        next,
        results: [
            ...Array.from({ length: topLevel }, (_, i) => ({ id: i + 1, parent: null })),
            ...Array.from({ length: replies }, (_, i) => ({ id: 100 + i, parent: 1 })),
        ],
    });

    it('reads the page size from the response, not a constant', () => {
        // 50 per page on the server, replies do not count toward the size
        expect(getTotalPages(page(50, 30, { count: 120, next: 'p2' }), 1, isTopLevelPost)).toBe(3);
        expect(getTotalPages(page(20, 0, { count: 45, next: 'p2' }), 1, isTopLevelPost)).toBe(3);
    });

    it('treats a page without next as the last page', () => {
        expect(getTotalPages(page(5, 2, { count: 45, next: null }), 3, isTopLevelPost)).toBe(3);
        expect(getTotalPages(page(7, 0, { count: 7, next: null }), 1, isTopLevelPost)).toBe(1);
    });

    it('returns 0 without data', () => {
        expect(getTotalPages(undefined, 1)).toBe(0);
        expect(getTotalPages({ count: 0, results: [] }, 1)).toBe(0);
    });
});
