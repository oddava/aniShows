import { describe, expect, it } from 'vitest';
import buildPostTree from '../buildPostTree';

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
});
