import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { animeApi, characterApi, genreApi, staffApi, studioApi } from '../client';

/*
 * Query keys for anime catalogue data.
 *
 * Every key below starts with 'anime', so invalidating or removing
 * `animeKeys.all` still reaches all of them (that is what the adult-content
 * toggle and list mutations rely on). `animeKeys.bySlug(slug)` is the prefix
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
 * Navbar search box. Deliberately NOT under 'anime': the Navbar is always
 * mounted, and list/status mutations invalidate ['anime'], which would refetch
 * the 100-title cache after every list change. Before react-query it loaded
 * once per mount, and it still does.
 */
export const navbarSearchKeys = {
    all: ['navbarSearch'],
    cache: () => ['navbarSearch', 'cache'],
    results: (query) => ['navbarSearch', 'results', query],
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

/** Only ever invalidated (AnimeCard); nothing reads it today. Kept so that call is unchanged. */
export const seasonalKeys = { all: ['seasonal'] };

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
    /** First 100 titles, matched locally with fuse.js. */
    cache: () => queryOptions({
        queryKey: navbarSearchKeys.cache(),
        queryFn: ({ signal }) => animeApi.getAll({ page_size: 100 }, signal)
            .then((res) => res.data.results || []),
    }),
    /** Server-side search for one (trimmed) query. */
    results: (query) => queryOptions({
        queryKey: navbarSearchKeys.results(query),
        queryFn: () => animeApi.getAll({ q: query, page_size: 10 })
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
