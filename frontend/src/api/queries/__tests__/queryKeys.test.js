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
    patchAnimeListStatus,
    scheduleQueries,
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
    friendsWatchingKeys,
    insightsKeys,
    insightsQueries,
    listKeys,
    listQueries,
    listSummaryKeys,
    miniProfileKeys,
    profileKeys,
    profileQueries,
    recommendationKeys,
    reviewKeys,
    socialQueries,
    staffFavoriteKeys,
    summaryToGenreRows,
    userKeys,
    userQueries,
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
    listApi: { getAll: vi.fn(), summary: vi.fn() },
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
    followApi: {},
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
        [navbarSearchKeys.results('fri', true), ['navbarSearch', 'results', 'fri', true]],
        [navbarSearchKeys.results('fri'), ['navbarSearch', 'results', 'fri', false]],
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
        [followKeys.search('kiyo', 'followers', 'ab'), ['follows', 'kiyo', 'followers', { search: 'ab' }]],
        [friendKeys.list('kiyo'), ['friends-infinite', 'kiyo']],
        [friendsWatchingKeys.all, ['friendsWatching']],
        [friendsWatchingKeys.byAnime(5, 9), ['friendsWatching', 5, 9]],
        [friendsWatchingKeys.byAnime(5), ['friendsWatching', 5, null]],
        [socialQueries.friendsWatching(5, 9).queryKey, ['friendsWatching', 5, 9]],
        [favoriteKeys.byUser('kiyo'), ['favorites', 'kiyo']],
        [favoriteKeys.overview('kiyo'), ['favorites-overview', 'kiyo']],
        [favoriteKeys.allForReorder('kiyo'), ['favorites', 'kiyo', 'all']],
        [characterFavoriteKeys.byUser('kiyo'), ['character-favorites', 'kiyo']],
        [characterFavoriteKeys.overview('kiyo'), ['character-favorites', 'kiyo', 'overview']],
        [staffFavoriteKeys.byUser('kiyo'), ['staff-favorites', 'kiyo']],
        [staffFavoriteKeys.overview('kiyo'), ['staff-favorites', 'kiyo', 'overview']],
        [listKeys.all, ['lists']],
        [listKeys.byStatus('kiyo', 'Watching'), ['lists', 'kiyo', 'Watching']],
        [listKeys.overview('kiyo', 'Watching'), ['lists', 'kiyo', 'Watching', 'overview']],
        [listKeys.paged('kiyo', 'Watching', 'fri', '-score'), ['lists', 'kiyo', 'Watching', 'paged', 'fri', '-score']],
        [listKeys.paged('kiyo', 'Watching', undefined, 'title'), ['lists', 'kiyo', 'Watching', 'paged', '', 'title']],
        [listKeys.preview('kiyo', 'Watching', 10), ['lists', 'kiyo', 'Watching', 'preview', 10]],
        [listSummaryKeys.byUser('kiyo'), ['lists', 'kiyo', 'summary']],
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
        [forumKeys.thread('9'), ['forumThread', '9']],
        [forumKeys.postsAll('9'), ['forumPosts', '9']],
        [forumKeys.posts('9', 3), ['forumPosts', '9', 3]],
        [forumKeys.postSubtree('9', 41), ['forumPosts', '9', 'root', 41, 1]],
        [forumKeys.postSubtree('9', 41, 3), ['forumPosts', '9', 'root', 41, 3]],
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
        seed(navbarSearchKeys.results('fri', false));
        seed(profileKeys.own);

        await client.invalidateQueries({ queryKey: animeKeys.all });

        animeEntries.forEach((key) => expect(invalidated(key)).toBe(true));
        expect(invalidated(navbarSearchKeys.results('fri', false))).toBe(false);
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
        seed(listKeys.paged('kiyo', 'Watching', '', '-updated_at'));
        seed(listSummaryKeys.byUser('kiyo'));
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
        expect(invalidated(listKeys.paged('kiyo', 'Watching', '', '-updated_at'))).toBe(true);
        expect(invalidated(listSummaryKeys.byUser('kiyo'))).toBe(true);
        expect(invalidated(userKeys.watching)).toBe(false);
        expect(invalidated(reviewKeys.byUser('kiyo'))).toBe(true);
        expect(invalidated(reviewKeys.forAnime('frieren', 'helpful', null))).toBe(true);
        expect(invalidated(reviewKeys.stats('frieren'))).toBe(false);
        expect(invalidated(followKeys.list('kiyo', 'following'))).toBe(true);
    });

    it('review stats are invalidated per anime, apart from the review lists', async () => {
        seed(reviewKeys.stats('frieren'));
        seed(reviewKeys.stats('bocchi'));
        seed(reviewKeys.forAnime('frieren', 'helpful', null));

        await client.invalidateQueries({ queryKey: reviewKeys.stats('frieren') });

        expect(invalidated(reviewKeys.stats('frieren'))).toBe(true);
        expect(invalidated(reviewKeys.stats('bocchi'))).toBe(false);
        expect(invalidated(reviewKeys.forAnime('frieren', 'helpful', null))).toBe(false);
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

describe('patchAnimeListStatus updates cached cards in place (B20, P1-9)', () => {
    const ENTRY = { id: 50, status: 'Watching', score: null, episodes_watched: 3, progress: 25 };
    const card = (id, userListStatus = null, extra = {}) => ({
        id, slug: `anime-${id}`, episode_count: 12, is_favorite: false, user_list_status: userListStatus, ...extra,
    });
    let client;

    beforeEach(() => {
        client = new QueryClient();
    });

    it('patches every cache shape under anime and schedule', () => {
        const other = card(8);
        const keys = {
            detail: animeKeys.detail('anime-7', 1),
            trending: animeKeys.trending('member-home'),
            topRated: animeKeys.topRated(),
            browseRow: animeKeys.browseRow(false),
            browseList: animeKeys.browseList({ sort: 'popular' }),
            recommendations: animeKeys.recommendations('anime-9'),
            schedule: scheduleKeys.week(true, false),
        };
        client.setQueryData(keys.detail, card(7, null, { relations: [{ id: 3, title: 'x' }] }));
        client.setQueryData(keys.trending, [card(7), other]);
        client.setQueryData(keys.topRated, { results: [other, card(7)], next: null });
        client.setQueryData(keys.browseRow, [{ key: 'a', anime_list: [card(7)] }, { key: 'b', anime_list: [other] }]);
        client.setQueryData(keys.browseList, {
            pages: [{ results: [other], next: 'x' }, { results: [card(7)], next: null }],
            pageParams: [1, 2],
        });
        client.setQueryData(keys.recommendations, { results: [other] });
        client.setQueryData(keys.schedule, { monday: [card(7)], tuesday: [other] });
        const recommendationsBefore = client.getQueryData(keys.recommendations);
        const otherRowBefore = client.getQueryData(keys.browseRow)[1];

        patchAnimeListStatus(client, 7, ENTRY);

        const status = (data) => data.user_list_status;
        expect(status(client.getQueryData(keys.detail))).toEqual(ENTRY);
        expect(status(client.getQueryData(keys.trending)[0])).toEqual(ENTRY);
        expect(status(client.getQueryData(keys.topRated).results[1])).toEqual(ENTRY);
        expect(status(client.getQueryData(keys.browseRow)[0].anime_list[0])).toEqual(ENTRY);
        expect(status(client.getQueryData(keys.browseList).pages[1].results[0])).toEqual(ENTRY);
        expect(client.getQueryData(keys.browseList).pageParams).toEqual([1, 2]);
        expect(status(client.getQueryData(keys.schedule).monday[0])).toEqual(ENTRY);

        // Other cards stay untouched, and so do queries without this anime.
        expect(client.getQueryData(keys.trending)[1]).toBe(other);
        expect(client.getQueryData(keys.browseRow)[1]).toBe(otherRowBefore);
        expect(client.getQueryData(keys.recommendations)).toBe(recommendationsBefore);
        expect(client.getQueryData(keys.detail).relations).toEqual([{ id: 3, title: 'x' }]);
    });

    it('returns new objects only along the changed path', () => {
        const untouchedPage = { results: [card(8)], next: 'x' };
        const key = animeKeys.browseList({ sort: 'rating' });
        client.setQueryData(key, { pages: [untouchedPage, { results: [card(7)], next: null }], pageParams: [1, 2] });

        patchAnimeListStatus(client, 7, ENTRY);

        expect(client.getQueryData(key).pages[0]).toBe(untouchedPage);
    });

    it('does not write a query whose data does not change', () => {
        const key = animeKeys.trending('guest-home');
        client.setQueryData(key, [card(7, ENTRY)]);
        const before = client.getQueryState(key).dataUpdatedAt;
        const data = client.getQueryData(key);
        const setQueryData = vi.spyOn(client, 'setQueryData');

        patchAnimeListStatus(client, 7, { ...ENTRY });
        patchAnimeListStatus(client, 99, ENTRY);

        expect(setQueryData).not.toHaveBeenCalled();
        expect(client.getQueryData(key)).toBe(data);
        expect(client.getQueryState(key).dataUpdatedAt).toBe(before);
    });

    it('merges partial updates, recomputes progress, and clears on removal', () => {
        const key = animeKeys.detail('anime-7', 1);
        client.setQueryData(key, card(7, ENTRY));

        patchAnimeListStatus(client, 7, { id: 50, episodes_watched: 6 });
        expect(client.getQueryData(key).user_list_status).toEqual({ ...ENTRY, episodes_watched: 6, progress: 50 });

        patchAnimeListStatus(client, 7, { id: 50, status: 'Completed' });
        expect(client.getQueryData(key).user_list_status.status).toBe('Completed');
        expect(client.getQueryData(key).user_list_status.episodes_watched).toBe(6);

        patchAnimeListStatus(client, '7', null);
        expect(client.getQueryData(key).user_list_status).toBeNull();
    });

    it('leaves episodes, characters and guest cards (no user_list_status) alone', () => {
        const episodes = animeKeys.watchEpisodes('anime-3', 50);
        const characters = animeKeys.characters('anime-3', 50);
        const guest = animeKeys.trending('guest-home');
        client.setQueryData(episodes, { pages: [{ results: [{ id: 7, title: 'Episode 7' }] }], pageParams: [1] });
        client.setQueryData(characters, { pages: [{ results: [{ id: 7, name: 'Frieren' }] }], pageParams: [1] });
        client.setQueryData(guest, [{ id: 7, slug: 'anime-7' }]);
        const before = [episodes, characters, guest].map((key) => client.getQueryData(key));

        patchAnimeListStatus(client, 7, ENTRY);

        expect([episodes, characters, guest].map((key) => client.getQueryData(key))).toEqual(before);
        [episodes, characters, guest].forEach((key, index) => {
            expect(client.getQueryData(key)).toBe(before[index]);
        });
    });

    it('never invalidates (no refetch of every grid)', () => {
        client.setQueryData(animeKeys.detail('anime-7', 1), card(7));
        const invalidate = vi.spyOn(client, 'invalidateQueries');

        patchAnimeListStatus(client, 7, ENTRY);

        expect(invalidate).not.toHaveBeenCalled();
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

    it('navbarSearchQueries run one server search and pass the abort signal', async () => {
        mocks.animeApi.getAll.mockResolvedValue({ data: { results: [{ id: 1 }] } });
        const signal = new AbortController().signal;
        await expect(navbarSearchQueries.results('frieren', true).queryFn({ ...fnContext, signal }))
            .resolves.toEqual([{ id: 1 }]);
        expect(mocks.animeApi.getAll).toHaveBeenLastCalledWith({ q: 'frieren', page_size: 10 }, signal);
        expect(navbarSearchQueries.results('frieren', true).queryKey).toEqual(['navbarSearch', 'results', 'frieren', true]);
        expect(navbarSearchQueries).not.toHaveProperty('cache');
    });

    it('listQueries.byStatus falls back from results to data', async () => {
        mocks.listApi.getAll.mockResolvedValue({ data: [{ id: 1 }] });
        await expect(listQueries.byStatus('kiyo', 'Completed').queryFn(fnContext)).resolves.toEqual([{ id: 1 }]);
        expect(mocks.listApi.getAll).toHaveBeenCalledWith({ status: 'Completed', username: 'kiyo' });
    });

    it('listQueries.paged asks the server for one page of 50, with search and ordering', async () => {
        mocks.listApi.getAll.mockResolvedValue({ data: { count: 120, next: 'x?page=2', results: [{ id: 1 }] } });
        const options = listQueries.paged('kiyo', 'Watching', 'fri', '-score');
        await expect(options.queryFn({ ...fnContext, pageParam: 2 })).resolves.toMatchObject({ count: 120 });
        expect(mocks.listApi.getAll).toHaveBeenCalledWith({
            username: 'kiyo', status: 'Watching', ordering: '-score', page: 2, page_size: 50, q: 'fri',
        });
        expect(options.getNextPageParam({ next: 'x?page=2' }, [{}])).toBe(2);
        expect(options.getNextPageParam({ next: null }, [{}, {}])).toBeUndefined();
    });

    it('listQueries.summary reads lists/summary/ (own list without a username)', async () => {
        mocks.listApi.summary.mockResolvedValue({ data: { total: 3 } });
        await expect(listQueries.summary('kiyo').queryFn(fnContext)).resolves.toEqual({ total: 3 });
        expect(mocks.listApi.summary).toHaveBeenLastCalledWith({ username: 'kiyo' });
        await listQueries.summary(undefined).queryFn(fnContext);
        expect(mocks.listApi.summary).toHaveBeenLastCalledWith({});
    });

    it('insightsQueries.overviewLists shares the summary request and keeps genre counts', () => {
        const options = insightsQueries.overviewLists('kiyo');
        expect(options.queryKey).toEqual(listSummaryKeys.byUser('kiyo'));
        const rows = options.select({ top_genres: [{ name: 'Action', slug: 'action', count: 3 }, { name: 'Drama', slug: 'drama', count: 1 }] });
        const counts = {};
        rows.forEach((row) => row.anime.genres.forEach((genre) => { counts[genre.name] = (counts[genre.name] || 0) + 1; }));
        expect(counts).toEqual({ Action: 3, Drama: 1 });
        expect(summaryToGenreRows(undefined)).toEqual([]);
    });

    it('userQueries.watching asks for six Watching entries', async () => {
        mocks.listApi.getAll.mockResolvedValue({ data: { results: [{ id: 1 }] } });
        await expect(userQueries.watching().queryFn(fnContext)).resolves.toEqual([{ id: 1 }]);
        expect(mocks.listApi.getAll).toHaveBeenLastCalledWith({ status: 'Watching', page_size: 6 });
    });

    it('insightsQueries.watching is a ten-entry Watching preview', async () => {
        mocks.listApi.getAll.mockResolvedValue({ data: { results: [] } });
        const options = insightsQueries.watching('kiyo');
        expect(options.queryKey).toEqual(listKeys.preview('kiyo', 'Watching', 10));
        await options.queryFn(fnContext);
        expect(mocks.listApi.getAll).toHaveBeenLastCalledWith({ username: 'kiyo', status: 'Watching', page_size: 10 });
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
