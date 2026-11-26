// Query keys and options owned by G3 Lists (feature-revamp seams).
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { activityApi, listApi, reviewApi } from '../client';
import { userKeys } from './profile';

/*
 * Query keys for lists, list summaries, activity and insights.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)`, `listKeys.overview(...)`, paged list
 * and `listSummaryKeys.byUser(...)` entry.
 */

export const LIST_STATUSES = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];

/** Server-side orderings of `GET lists/` (`ordering=`), default first. */
export const LIST_ORDERINGS = [
    { value: '-updated_at', label: 'Recently updated' },
    { value: 'title', label: 'Title' },
    { value: '-score', label: 'Score' },
    { value: '-progress', label: 'Progress' },
    { value: 'started_at', label: 'Start date' },
    { value: '-finished_at', label: 'Finish date' },
];

export const LIST_PAGE_SIZE = 50;

const resultsOrData = (res) => res.data.results || res.data || [];
const usernameParam = (username) => (username ? { username } : {});

export const listKeys = {
    all: ['lists'],
    byStatus: (username, status) => ['lists', username, status],
    overview: (username, status) => ['lists', username, status, 'overview'],
    /** The profile list tab: every page of one status, filtered and sorted on the server. */
    paged: (username, status, search, ordering) => ['lists', username, status, 'paged', search || '', ordering],
    /** A short first page (Insights' "Progress" card). */
    preview: (username, status, pageSize) => ['lists', username, status, 'preview', pageSize],
};

/** Under `['lists']`, so every list invalidation also refreshes the summary. */
export const listSummaryKeys = {
    byUser: (username) => ['lists', username, 'summary'],
};

export const activityKeys = {
    heatmap: (username) => ['activity-heatmap', username],
    feed: (username, filterType, pageSize) => ['activity-feed', username, filterType, pageSize],
};

export const insightsKeys = {
    /** Kept for compatibility; Insights now reads `listSummaryKeys` and `listKeys.preview`. */
    lists: (username) => ['profile-insights-lists', username],
    /** Kept for compatibility; `insightsQueries.overviewLists` now shares the summary key. */
    overviewLists: (username) => ['insights-lists', username],
    reviews: (username) => ['insights-reviews', username],
};

export const userQueries = {
    /** Home "Continue": the twelve most recently updated Watching entries, with banner art. */
    watching: () => queryOptions({
        queryKey: userKeys.watching,
        queryFn: () => listApi.getAll({ status: 'Watching', page_size: 12, artwork: 1 }).then(resultsOrData),
    }),
};

/** `next` page number for DRF page responses, counted from the pages loaded so far. */
const nextListPage = (lastPage, allPages) => (lastPage?.next ? allPages.length + 1 : undefined);

export const listQueries = {
    byStatus: (username, status) => queryOptions({
        queryKey: listKeys.byStatus(username, status),
        queryFn: () => listApi.getAll({ status, username }).then(resultsOrData),
    }),
    overview: (username, status, pageSize) => queryOptions({
        queryKey: listKeys.overview(username, status),
        queryFn: () => listApi.getAll({
            status,
            username,
            page: 1,
            page_size: pageSize,
        }).then(resultsOrData),
    }),
    /** All of one status, `LIST_PAGE_SIZE` per page; pages are DRF `{count, next, results}`. */
    paged: (username, status, search, ordering) => infiniteQueryOptions({
        queryKey: listKeys.paged(username, status, search, ordering),
        queryFn: ({ pageParam }) => listApi.getAll({
            username,
            status,
            ordering,
            page: pageParam,
            page_size: LIST_PAGE_SIZE,
            ...(search ? { q: search } : {}),
        }).then((res) => res.data),
        initialPageParam: 1,
        getNextPageParam: nextListPage,
    }),
    preview: (username, status, pageSize) => queryOptions({
        queryKey: listKeys.preview(username, status, pageSize),
        queryFn: () => listApi.getAll({ username, status, page_size: pageSize }).then(resultsOrData),
    }),
    /** Counts, totals, score histogram and top genres: `GET lists/summary/`. */
    summary: (username) => queryOptions({
        queryKey: listSummaryKeys.byUser(username),
        queryFn: () => listApi.summary(usernameParam(username)).then((res) => res.data),
    }),
};

export const activityQueries = {
    heatmap: (username) => queryOptions({
        queryKey: activityKeys.heatmap(username),
        queryFn: () => activityApi.getHeatmap({ username }).then((res) => res.data),
    }),
};

/**
 * Compatibility adapter for G1's OverviewTab genre sidebar, which counts
 * `item.anime.genres[].name` over a flat array of list rows. Rebuilds an array
 * with the same genre counts from the summary's `top_genres`, so the sidebar
 * reflects the whole list (not page 1 of each status) and shares the summary
 * request. Remove once OverviewTab reads `listQueries.summary` (G1 request).
 */
export const summaryToGenreRows = (summary) => (summary?.top_genres || []).flatMap((genre) => {
    const row = { anime: { genres: [{ name: genre.name, slug: genre.slug }] } };
    return Array(Math.max(Number(genre.count) || 0, 0)).fill(row);
});

export const insightsQueries = {
    /** Insights' "Progress" card: the ten most recently updated Watching entries. */
    watching: (username) => listQueries.preview(username, 'Watching', 10),
    overviewLists: (username) => queryOptions({
        ...listQueries.summary(username),
        select: summaryToGenreRows,
    }),
    reviews: (username) => queryOptions({
        queryKey: insightsKeys.reviews(username),
        queryFn: () => reviewApi.getAll({ user: username }).then(resultsOrData),
    }),
};
