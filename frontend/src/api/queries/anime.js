import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { animeApi, characterApi, genreApi, staffApi, studioApi } from '../client';

/*
 * Query keys for anime catalogue data.
 *
 * Every key below starts with 'anime', so invalidating or removing
 * `animeKeys.all` still reaches all of them (the adult-content toggle relies on
 * that; list changes patch them in place, see patchAnimeListStatus). `animeKeys.bySlug(slug)` is the prefix
 * for everything about one title.
 *
 * The arrays are kept exactly as they were when they were written inline, so
 * the cache entries are the same ones as before the factory existed.
 */
export const animeKeys = {
    all: ['anime'],
    bySlug: (slug) => ['anime', slug],
    detail: (slug, viewerId) => ['anime', slug, viewerId || 'anonymous'],
    watchPreview: (slug) => ['anime', slug, 'watch-episodes-preview'],
    watchEpisodes: (slug, pageSize) => ['anime', slug, 'watch-episodes', pageSize],
    characters: (slug, pageSize) => ['anime', slug, 'characters', pageSize],
    staff: (slug, pageSize) => ['anime', slug, 'staff', pageSize],
    episodeRatingsAll: (slug) => ['anime', slug, 'episode-ratings'],
    episodeRatings: (slug, viewerId) => ['anime', slug, 'episode-ratings', viewerId || 'anonymous'],
    recommendations: (slug) => ['anime', slug, 'recommendations'],
    browseRow: (adultContentEnabled) => ['anime', 'browse-row', adultContentEnabled],
    /** variant: 'member-home' | 'guest-home' */
    trending: (variant) => ['anime', 'trending', variant],
    heroTrending: () => ['anime', 'hero-trending'],
    topRated: () => ['anime', 'top-rated'],
    lists: () => ['anime', 'list'],
    /**
     * The Browse grid key. Browse and its next-page prefetch both build it
     * here, so the prefetch always lands in the entry Browse reads. Callers
     * pass the values already normalised (joined strings, '' for unset).
     */
    browseList: (f) => [
        'anime',
        'list',
        f.genres,
        f.tags,
        f.sort,
        f.search,
        f.type,
        f.status,
        f.studio,
        f.season,
        f.year,
        f.excludeIds,
        f.shelf,
        f.minRating,
        f.maxRating,
        f.source,
        f.minEpisodes,
        f.maxEpisodes,
        f.minDuration,
        f.maxDuration,
        f.minYear,
        f.maxYear,
        f.adultContentEnabled,
    ],
    /** Key used by useInfiniteAnime (object-shaped filters). */
    filteredList: (filters) => ['anime', 'list', filters],
};

/*
 * Search suggestions (navbar and hero search). Deliberately NOT under 'anime',
 * so the adult-content toggle's removeQueries(['anime']) doesn't drop the
 * suggestions of an open search box; the adult flag is part of the key
 * instead, so switching it never shows the other setting's suggestions.
 */
export const navbarSearchKeys = {
    all: ['navbarSearch'],
    results: (query, adultContentEnabled = false) => [
        'navbarSearch', 'results', query, Boolean(adultContentEnabled),
    ],
};

export const characterKeys = {
    all: ['character'],
    detail: (id) => ['character', id],
};

export const staffKeys = {
    all: ['staff'],
    detail: (id) => ['staff', id],
};

export const genreKeys = { all: ['genres'] };
export const studioKeys = { all: ['studios'] };

export const scheduleKeys = {
    all: ['schedule'],
    week: (isAuthenticated, adultContentEnabled) => ['schedule', isAuthenticated, adultContentEnabled],
};

const isPlainObject = (value) => value !== null
    && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;

const nextListStatus = (anime, userListStatus) => {
    if (!userListStatus) return null;
    const merged = { ...(anime.user_list_status || {}), ...userListStatus };
    const episodeCount = Number(anime.episode_count) || 0;
    if (!('progress' in userListStatus) && 'episodes_watched' in userListStatus) {
        merged.progress = episodeCount > 0 ? (merged.episodes_watched / episodeCount) * 100 : 0;
    }
    return merged;
};

const sameListStatus = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => a[key] === b[key]);
};

/*
 * Walks one cached payload and returns it with `user_list_status` replaced on
 * every card for `animeId`, or the same reference when nothing matched (so
 * untouched queries don't re-render). Covers every shape under ['anime'] and
 * ['schedule']: plain arrays, `{ results }` pages, infinite `{ pages, pageParams }`,
 * browse rows (`[{ anime_list }]`), the detail payload and the schedule days map.
 * Only objects that already carry a `user_list_status` key are anime cards
 * (signed-in payloads always include it), so episodes, characters or staff
 * that happen to share the id are left alone.
 */
const patchNode = (node, animeId, userListStatus) => {
    if (Array.isArray(node)) {
        let changed = false;
        const next = node.map((item) => {
            const patched = patchNode(item, animeId, userListStatus);
            if (patched !== item) changed = true;
            return patched;
        });
        return changed ? next : node;
    }
    if (!isPlainObject(node)) return node;

    let next = node;
    if ('user_list_status' in node && node.id != null && String(node.id) === String(animeId)) {
        const status = nextListStatus(node, userListStatus);
        if (!sameListStatus(status, node.user_list_status)) {
            next = { ...node, user_list_status: status };
        }
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === 'user_list_status' || value === null || typeof value !== 'object') continue;
        const patched = patchNode(value, animeId, userListStatus);
        if (patched !== value) {
            if (next === node) next = { ...node };
            next[key] = patched;
        }
    }
    return next;
};

/**
 * Bring cached anime payloads up to date after a list change (G2 contract, used by
 * AnimeCard and G3's useListEntryMutation; B20, P1-9). Patches `user_list_status`
 * in place in every ['anime'] and ['schedule'] query that shows `animeId`, instead
 * of refetching every grid, shelf and detail page.
 *
 * `userListStatus`: `null` when the entry was removed; otherwise the entry (the
 * `user_list_status` shape). It is merged over the cached value, so callers may
 * pass only the fields they changed (`{ id, status }`); `progress` follows a new
 * `episodes_watched`.
 */
export const patchAnimeListStatus = (queryClient, animeId, userListStatus) => {
    if (animeId === undefined || animeId === null) return;
    [animeKeys.all, scheduleKeys.all].forEach((queryKey) => {
        // Like setQueriesData, but a query whose payload doesn't show this
        // anime is not written at all (its data and timestamps stay as they are).
        queryClient.getQueriesData({ queryKey }).forEach(([key, data]) => {
            if (data === undefined) return;
            const patched = patchNode(data, animeId, userListStatus);
            if (patched !== data) queryClient.setQueryData(key, patched);
        });
    });
};

const data = (res) => res.data;

/** Next page number from DRF's absolute `next` URL (what AnimeDetail has always used). */
export const nextPageFromUrl = (lastPage) => {
    if (!lastPage?.next) {
        return undefined;
    }

    try {
        const url = new URL(lastPage.next);
        const nextPage = Number.parseInt(url.searchParams.get('page'), 10);
        return Number.isFinite(nextPage) && nextPage > 0 ? nextPage : undefined;
    } catch {
        return undefined;
    }
};

export const animeQueries = {
    detail: (slug, viewerId) => queryOptions({
        queryKey: animeKeys.detail(slug, viewerId),
        queryFn: () => animeApi.getBySlug(slug).then(data),
    }),
    watchPreview: (slug, pageSize) => queryOptions({
        queryKey: animeKeys.watchPreview(slug),
        queryFn: () => animeApi.getWatchEpisodes(slug, { page: 1, page_size: pageSize }).then(data),
    }),
    watchEpisodes: (slug, pageSize) => infiniteQueryOptions({
        queryKey: animeKeys.watchEpisodes(slug, pageSize),
        queryFn: ({ pageParam }) => animeApi.getWatchEpisodes(slug, {
            page: pageParam,
            page_size: pageSize,
        }).then(data),
        initialPageParam: 1,
        getNextPageParam: nextPageFromUrl,
    }),
    characters: (slug, pageSize) => infiniteQueryOptions({
        queryKey: animeKeys.characters(slug, pageSize),
        queryFn: ({ pageParam }) => animeApi.getCharacters(slug, {
            page: pageParam,
            page_size: pageSize,
        }).then(data),
        initialPageParam: 1,
        getNextPageParam: nextPageFromUrl,
    }),
    staff: (slug, pageSize) => infiniteQueryOptions({
        queryKey: animeKeys.staff(slug, pageSize),
        queryFn: ({ pageParam }) => animeApi.getStaff(slug, {
            page: pageParam,
            page_size: pageSize,
        }).then(data),
        initialPageParam: 1,
        getNextPageParam: nextPageFromUrl,
    }),
    episodeRatings: (slug, viewerId) => queryOptions({
        queryKey: animeKeys.episodeRatings(slug, viewerId),
        queryFn: () => animeApi.getEpisodeRatings(slug).then(data),
    }),
    recommendations: (slug) => queryOptions({
        queryKey: animeKeys.recommendations(slug),
        queryFn: () => animeApi.getRecommendations(slug).then(data),
    }),
    trending: (variant) => queryOptions({
        queryKey: animeKeys.trending(variant),
        queryFn: () => animeApi.getTrending().then(data),
    }),
    heroTrending: () => queryOptions({
        queryKey: animeKeys.heroTrending(),
        queryFn: () => animeApi.getTrending().then(data),
    }),
    topRated: () => queryOptions({
        queryKey: animeKeys.topRated(),
        queryFn: () => animeApi.getTopRated().then(data),
    }),
};

export const navbarSearchQueries = {
    /**
     * Server-side search (relevance-ranked) for one trimmed query. The signal
     * is passed through, so a request for a query the user has typed past is
     * aborted when its key loses its last observer.
     */
    results: (query, adultContentEnabled = false) => queryOptions({
        queryKey: navbarSearchKeys.results(query, adultContentEnabled),
        queryFn: ({ signal }) => animeApi.getAll({ q: query, page_size: 10 }, signal)
            .then((res) => res.data.results || []),
    }),
};

export const characterQueries = {
    detail: (id) => queryOptions({
        queryKey: characterKeys.detail(id),
        queryFn: ({ signal }) => characterApi.getById(id, signal).then(data),
    }),
};

export const staffQueries = {
    detail: (id) => queryOptions({
        queryKey: staffKeys.detail(id),
        queryFn: ({ signal }) => staffApi.getById(id, signal).then(data),
    }),
};

export const genreQueries = {
    all: () => queryOptions({
        queryKey: genreKeys.all,
        queryFn: () => genreApi.getAll().then(data),
    }),
};

export const studioQueries = {
    all: () => queryOptions({
        queryKey: studioKeys.all,
        queryFn: () => studioApi.getAll().then(data),
    }),
};

export const scheduleQueries = {
    week: (isAuthenticated, adultContentEnabled) => queryOptions({
        queryKey: scheduleKeys.week(isAuthenticated, adultContentEnabled),
        queryFn: async () => {
            const response = await animeApi.getSchedule();
            return response.data?.days || {};
        },
    }),
};
