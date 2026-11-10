import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
    animeKeys,
    animeQueries,
    characterKeys,
    genreKeys,
    navbarSearchKeys,
    navbarSearchQueries,
    scheduleKeys,
    scheduleQueries,
    seasonalKeys,
    staffKeys,
    studioKeys,
} from '../anime';
import {
    activityKeys,
    badgeKeys,
    characterFavoriteKeys,
    favoriteKeys,
    followKeys,
    friendKeys,
    insightsKeys,
    insightsQueries,
    listKeys,
    listQueries,
    miniProfileKeys,
    profileKeys,
    profileQueries,
    recommendationKeys,
    reviewKeys,
    staffFavoriteKeys,
    userKeys,
} from '../user';
import { forumKeys, forumQueries } from '../forums';
import { adminBadgeKeys } from '../admin';

const mocks = vi.hoisted(() => ({
    animeApi: {
        getBySlug: vi.fn(),
        getAll: vi.fn(),
        getSchedule: vi.fn(),
        getWatchEpisodes: vi.fn(),
    },
    authApi: { getByUsername: vi.fn(), getProfile: vi.fn() },
    listApi: { getAll: vi.fn() },
    forumsApi: { getThreads: vi.fn() },
}));

vi.mock('../../client', () => ({
    default: { get: vi.fn() },
    animeApi: mocks.animeApi,
    authApi: mocks.authApi,
    listApi: mocks.listApi,
    forumsApi: mocks.forumsApi,
    characterApi: {},
    genreApi: {},
    staffApi: {},
    studioApi: {},
    activityApi: {},
    badgeApi: {},
    characterFavoriteApi: {},
    favoriteApi: {},
    recommendationsApi: {},
    reviewApi: {},
    staffFavoriteApi: {},
    adminBadgeApi: {},
}));

const fnContext = { signal: undefined, pageParam: 1, queryKey: [], meta: undefined };

describe('query keys keep the shapes the app used before the factory', () => {
    // Each pair is [factory output, the literal that used to be written inline].
    it.each([
        [animeKeys.all, ['anime']],
        [animeKeys.bySlug('frieren'), ['anime', 'frieren']],
        [animeKeys.detail('frieren', 7), ['anime', 'frieren', 7]],
        [animeKeys.detail('frieren', undefined), ['anime', 'frieren', 'anonymous']],
        [animeKeys.watchPreview('frieren'), ['anime', 'frieren', 'watch-episodes-preview']],
        [animeKeys.watchEpisodes('frieren', 50), ['anime', 'frieren', 'watch-episodes', 50]],
        [animeKeys.characters('frieren', 50), ['anime', 'frieren', 'characters', 50]],
        [animeKeys.staff('frieren', 50), ['anime', 'frieren', 'staff', 50]],
        [animeKeys.episodeRatingsAll('frieren'), ['anime', 'frieren', 'episode-ratings']],
        [animeKeys.episodeRatings('frieren', null), ['anime', 'frieren', 'episode-ratings', 'anonymous']],
        [animeKeys.recommendations('frieren'), ['anime', 'frieren', 'recommendations']],
        [animeKeys.browseRow(false), ['anime', 'browse-row', false]],
        [animeKeys.trending('member-home'), ['anime', 'trending', 'member-home']],
        [animeKeys.heroTrending(), ['anime', 'hero-trending']],
        [animeKeys.topRated(), ['anime', 'top-rated']],
        [animeKeys.filteredList({ sort: 'popular' }), ['anime', 'list', { sort: 'popular' }]],
        [characterKeys.detail('5'), ['character', '5']],
        [staffKeys.detail('5'), ['staff', '5']],
        [genreKeys.all, ['genres']],
        [studioKeys.all, ['studios']],
        [scheduleKeys.all, ['schedule']],
        [scheduleKeys.week(true, false), ['schedule', true, false]],
        [seasonalKeys.all, ['seasonal']],
        [profileKeys.own, ['ownProfile']],
        [profileKeys.all, ['profile']],
        [profileKeys.me, ['profile', 'me']],
        [profileKeys.byUsername('kiyo'), ['profile', 'kiyo']],
        [userKeys.byUsername('kiyo'), ['user', 'kiyo']],
        [userKeys.me, ['user', 'me']],
        [userKeys.watching, ['user', 'list', 'watching']],
        [userKeys.profileLegacy, ['userProfile']],
        [followKeys.all, ['follows']],
        [followKeys.list('kiyo', 'followers'), ['follows', 'kiyo', 'followers']],
        [friendKeys.list('kiyo'), ['friends-infinite', 'kiyo']],
        [favoriteKeys.byUser('kiyo'), ['favorites', 'kiyo']],
        [favoriteKeys.overview('kiyo'), ['favorites-overview', 'kiyo']],
        [characterFavoriteKeys.byUser('kiyo'), ['character-favorites', 'kiyo']],
        [characterFavoriteKeys.overview('kiyo'), ['character-favorites', 'kiyo', 'overview']],
        [staffFavoriteKeys.byUser('kiyo'), ['staff-favorites', 'kiyo']],
        [staffFavoriteKeys.overview('kiyo'), ['staff-favorites', 'kiyo', 'overview']],
        [listKeys.all, ['lists']],
        [listKeys.byStatus('kiyo', 'Watching'), ['lists', 'kiyo', 'Watching']],
        [listKeys.overview('kiyo', 'Watching'), ['lists', 'kiyo', 'Watching', 'overview']],
        [reviewKeys.all, ['reviews']],
        [reviewKeys.byUser('kiyo'), ['reviews', 'kiyo']],
        [reviewKeys.forAnime('frieren', 'helpful', null), ['reviews', 'frieren', 'helpful', null]],
        [reviewKeys.stats('frieren'), ['reviewStats', 'frieren']],
        [activityKeys.heatmap('kiyo'), ['activity-heatmap', 'kiyo']],
        [activityKeys.feed('kiyo', 'all', 20), ['activity-feed', 'kiyo', 'all', 20]],
        [insightsKeys.lists('kiyo'), ['profile-insights-lists', 'kiyo']],
        [insightsKeys.overviewLists('kiyo'), ['insights-lists', 'kiyo']],
        [insightsKeys.reviews('kiyo'), ['insights-reviews', 'kiyo']],
        [miniProfileKeys.watching('kiyo'), ['mini-profile', 'kiyo', 'watching']],
        [miniProfileKeys.favorites('kiyo'), ['mini-profile', 'kiyo', 'favorites']],
        [badgeKeys.mine, ['myBadges']],
        [recommendationKeys.all, ['recommendations']],
        [forumKeys.categories, ['forumCategories']],
        [forumKeys.category('general'), ['forumCategory', 'general']],
        [forumKeys.tags, ['forumTags']],
        [forumKeys.threadsAll, ['forumThreads']],
        [forumKeys.threads('general', '', 2), ['forumThreads', 'general', '', 2]],
        [forumKeys.activeThreads(1), ['forumActiveThreads', 1]],
        [forumKeys.newThreads(1), ['forumNewThreads', 1]],
        [forumKeys.search('aot', 1), ['forumSearch', 'aot', 1]],
        [forumKeys.railFeed, ['forumRailFeed']],
        [forumKeys.thread('9'), ['forumThread', '9']],
        [forumKeys.postsAll('9'), ['forumPosts', '9']],
        [forumKeys.posts('9', 3), ['forumPosts', '9', 3]],
        [adminBadgeKeys.all, ['adminBadges']],
        [adminBadgeKeys.list(1, ''), ['adminBadges', 1, '']],
        [adminBadgeKeys.holdersAll(4), ['adminBadgeHolders', 4]],
        [adminBadgeKeys.holders(4, 2), ['adminBadgeHolders', 4, 2]],
        [adminBadgeKeys.userSearch('al'), ['adminUsersSearch', 'al']],
    ])('%j', (actual, expected) => {
        expect(actual).toEqual(expected);
    });

    it('builds the positional Browse grid key in the original order', () => {
        const key = animeKeys.browseList({
            genres: 'action', tags: '', sort: 'popular', search: '', type: '', status: '',
            studio: '', season: '', year: '', excludeIds: '', shelf: '', minRating: '',
            maxRating: '', source: '', minEpisodes: '', maxEpisodes: '', minDuration: '',
            maxDuration: '', minYear: '', maxYear: '2020', adultContentEnabled: true,
        });
        expect(key).toEqual([
            'anime', 'list', 'action', '', 'popular', '', '', '', '', '', '', '', '', '',
            '', '', '', '', '', '', '', '2020', true,
        ]);
    });
});

describe('prefix invalidation still reaches the same cache entries', () => {
    let client;
    const seed = (key) => client.setQueryData(key, { seeded: true });
    const invalidated = (key) => client.getQueryState(key)?.isInvalidated === true;

    beforeEach(() => {
        client = new QueryClient();
    });

    it('animeKeys.all covers every anime key but not the Navbar search cache', async () => {
        const animeEntries = [
            animeKeys.detail('frieren', 1),
            animeKeys.episodeRatings('frieren', 1),
            animeKeys.browseRow(true),
            animeKeys.trending('guest-home'),
            animeKeys.filteredList({}),
        ];
        animeEntries.forEach(seed);
        seed(navbarSearchKeys.cache());
        seed(profileKeys.own);

        await client.invalidateQueries({ queryKey: animeKeys.all });

        animeEntries.forEach((key) => expect(invalidated(key)).toBe(true));
        expect(invalidated(navbarSearchKeys.cache())).toBe(false);
        expect(invalidated(profileKeys.own)).toBe(false);
    });

    it('animeKeys.bySlug and episodeRatingsAll stay scoped to one title', async () => {
        seed(animeKeys.detail('frieren', 1));
        seed(animeKeys.episodeRatings('frieren', 1));
        seed(animeKeys.detail('bocchi', 1));

        await client.invalidateQueries({ queryKey: animeKeys.episodeRatingsAll('frieren') });
        expect(invalidated(animeKeys.episodeRatings('frieren', 1))).toBe(true);
        expect(invalidated(animeKeys.detail('frieren', 1))).toBe(false);

        client.removeQueries({ queryKey: animeKeys.bySlug('frieren') });
        expect(client.getQueryData(animeKeys.detail('frieren', 1))).toBeUndefined();
        expect(client.getQueryData(animeKeys.detail('bocchi', 1))).toEqual({ seeded: true });
    });

    it('profile, list, review and follow prefixes cover their children only', async () => {
        seed(profileKeys.byUsername('kiyo'));
        seed(profileKeys.me);
        seed(profileKeys.own);
        seed(listKeys.byStatus('kiyo', 'Watching'));
        seed(listKeys.overview('kiyo', 'Watching'));
        seed(userKeys.watching);
        seed(reviewKeys.byUser('kiyo'));
        seed(reviewKeys.forAnime('frieren', 'helpful', null));
        seed(reviewKeys.stats('frieren'));
        seed(followKeys.list('kiyo', 'following'));

        await client.invalidateQueries({ queryKey: profileKeys.all });
        await client.invalidateQueries({ queryKey: listKeys.all });
        await client.invalidateQueries({ queryKey: reviewKeys.all });
        await client.invalidateQueries({ queryKey: followKeys.all });

        expect(invalidated(profileKeys.byUsername('kiyo'))).toBe(true);
        expect(invalidated(profileKeys.me)).toBe(true);
        expect(invalidated(profileKeys.own)).toBe(false);
        expect(invalidated(listKeys.byStatus('kiyo', 'Watching'))).toBe(true);
        expect(invalidated(listKeys.overview('kiyo', 'Watching'))).toBe(true);
        expect(invalidated(userKeys.watching)).toBe(false);
        expect(invalidated(reviewKeys.byUser('kiyo'))).toBe(true);
        expect(invalidated(reviewKeys.forAnime('frieren', 'helpful', null))).toBe(true);
        expect(invalidated(reviewKeys.stats('frieren'))).toBe(false);
        expect(invalidated(followKeys.list('kiyo', 'following'))).toBe(true);
    });

    it('forum prefixes cover every page', async () => {
        seed(forumKeys.threads('general', '', 1));
        seed(forumKeys.posts('9', 1));
        seed(forumKeys.posts('9', 2));
        seed(forumKeys.posts('10', 1));

        await client.invalidateQueries({ queryKey: forumKeys.threadsAll });
        await client.invalidateQueries({ queryKey: forumKeys.postsAll('9') });

        expect(invalidated(forumKeys.threads('general', '', 1))).toBe(true);
        expect(invalidated(forumKeys.posts('9', 1))).toBe(true);
        expect(invalidated(forumKeys.posts('9', 2))).toBe(true);
        expect(invalidated(forumKeys.posts('10', 1))).toBe(false);
    });

    it('setQueryData through a factory key is read back by the matching queryOptions', () => {
        client.setQueryData(profileKeys.byUsername('kiyo'), { username: 'kiyo' });
        expect(client.getQueryData(profileQueries.byUsername('kiyo').queryKey)).toEqual({ username: 'kiyo' });

        client.setQueryData(animeKeys.detail('frieren'), { slug: 'frieren' });
        expect(client.getQueryData(animeQueries.detail('frieren', undefined).queryKey)).toEqual({ slug: 'frieren' });
    });
});

describe('queryOptions call the same endpoints as the inline queryFns did', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('animeQueries.detail unwraps the response', async () => {
        mocks.animeApi.getBySlug.mockResolvedValue({ data: { slug: 'frieren' } });
        await expect(animeQueries.detail('frieren', 3).queryFn(fnContext)).resolves.toEqual({ slug: 'frieren' });
        expect(mocks.animeApi.getBySlug).toHaveBeenCalledWith('frieren');
    });

    it('animeQueries.watchEpisodes pages with the requested size and parses DRF next links', async () => {
        mocks.animeApi.getWatchEpisodes.mockResolvedValue({ data: { results: [] } });
        const options = animeQueries.watchEpisodes('frieren', 50);
        await options.queryFn({ ...fnContext, pageParam: 2 });
        expect(mocks.animeApi.getWatchEpisodes).toHaveBeenCalledWith('frieren', { page: 2, page_size: 50 });
        expect(options.initialPageParam).toBe(1);
        expect(options.getNextPageParam({ next: 'https://x.test/api/?page=3' })).toBe(3);
        expect(options.getNextPageParam({ next: null })).toBeUndefined();
    });

    it('scheduleQueries.week returns the days map', async () => {
        mocks.animeApi.getSchedule.mockResolvedValue({ data: { days: { monday: [] } } });
        await expect(scheduleQueries.week(true, false).queryFn(fnContext)).resolves.toEqual({ monday: [] });
        mocks.animeApi.getSchedule.mockResolvedValue({ data: {} });
        await expect(scheduleQueries.week(true, false).queryFn(fnContext)).resolves.toEqual({});
    });

    it('navbarSearchQueries fetch the cache and a single search', async () => {
        mocks.animeApi.getAll.mockResolvedValue({ data: { results: [{ id: 1 }] } });
        await expect(navbarSearchQueries.cache().queryFn(fnContext)).resolves.toEqual([{ id: 1 }]);
        expect(mocks.animeApi.getAll).toHaveBeenLastCalledWith({ page_size: 100 }, undefined);
        await navbarSearchQueries.results('frieren').queryFn(fnContext);
        expect(mocks.animeApi.getAll).toHaveBeenLastCalledWith({ q: 'frieren', page_size: 10 });
    });

    it('listQueries.byStatus falls back from results to data', async () => {
        mocks.listApi.getAll.mockResolvedValue({ data: [{ id: 1 }] });
        await expect(listQueries.byStatus('kiyo', 'Completed').queryFn(fnContext)).resolves.toEqual([{ id: 1 }]);
        expect(mocks.listApi.getAll).toHaveBeenCalledWith({ status: 'Completed', username: 'kiyo' });
    });

    it('insightsQueries.lists keeps going when one status fails', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.listApi.getAll.mockImplementation(({ status }) => (
            status === 'Dropped'
                ? Promise.reject(new Error('boom'))
                : Promise.resolve({ data: { results: [{ status }] } })
        ));
        const result = await insightsQueries.lists('kiyo').queryFn(fnContext);
        expect(result).toHaveLength(5);
        expect(result.at(-1)).toEqual({ status: 'Dropped', items: [] });
        expect(result[0]).toEqual({ status: 'Watching', items: [{ status: 'Watching' }] });
        spy.mockRestore();
    });

    it('forumQueries.threads drops an empty tag', async () => {
        mocks.forumsApi.getThreads.mockResolvedValue({ results: [] });
        await forumQueries.threads('general', '', 2).queryFn(fnContext);
        expect(mocks.forumsApi.getThreads).toHaveBeenCalledWith({
            category__slug: 'general',
            tags__slug: undefined,
            page: 2,
        });
    });
});
