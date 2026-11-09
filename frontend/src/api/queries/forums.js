import { queryOptions } from '@tanstack/react-query';

import { forumsApi } from '../client';

/*
 * Query keys for the forums. `forumKeys.threadsAll` (['forumThreads']) is the
 * prefix of every thread-list page, and `forumKeys.postsAll(id)` of every
 * page of one thread's posts, as before.
 */
export const forumKeys = {
    categories: ['forumCategories'],
    category: (slug) => ['forumCategory', slug],
    tags: ['forumTags'],
    threadsAll: ['forumThreads'],
    threads: (slug, tag, page) => ['forumThreads', slug, tag, page],
    activeThreads: (page) => ['forumActiveThreads', page],
    newThreads: (page) => ['forumNewThreads', page],
    search: (query, page) => ['forumSearch', query, page],
    railFeed: ['forumRailFeed'],
    thread: (id) => ['forumThread', id],
    postsAll: (threadId) => ['forumPosts', threadId],
    posts: (threadId, page) => ['forumPosts', threadId, page],
};

// forumsApi methods already unwrap `response.data`.
export const forumQueries = {
    categories: () => queryOptions({
        queryKey: forumKeys.categories,
        queryFn: () => forumsApi.getCategories(),
    }),
    category: (slug) => queryOptions({
        queryKey: forumKeys.category(slug),
        queryFn: () => forumsApi.getCategory(slug),
    }),
    tags: () => queryOptions({
        queryKey: forumKeys.tags,
        queryFn: () => forumsApi.getTags(),
    }),
    threads: (slug, tag, page) => queryOptions({
        queryKey: forumKeys.threads(slug, tag, page),
        queryFn: () => forumsApi.getThreads({
            category__slug: slug,
            tags__slug: tag || undefined,
            page,
        }),
    }),
    activeThreads: (page) => queryOptions({
        queryKey: forumKeys.activeThreads(page),
        queryFn: () => forumsApi.getGlobalFeed(page),
    }),
    newThreads: (page) => queryOptions({
        queryKey: forumKeys.newThreads(page),
        queryFn: () => forumsApi.getThreads({ ordering: '-created_at', page }),
    }),
    search: (query, page) => queryOptions({
        queryKey: forumKeys.search(query, page),
        queryFn: () => forumsApi.getThreads({ search: query, page }),
    }),
    railFeed: () => queryOptions({
        queryKey: forumKeys.railFeed,
        queryFn: () => forumsApi.getGlobalFeed(1),
    }),
    thread: (id) => queryOptions({
        queryKey: forumKeys.thread(id),
        queryFn: () => forumsApi.getThread(id),
    }),
    posts: (threadId, page) => queryOptions({
        queryKey: forumKeys.posts(threadId, page),
        queryFn: () => forumsApi.getPosts(threadId, page),
    }),
};
