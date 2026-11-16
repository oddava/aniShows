import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AnimeDetail from '../AnimeDetail';
import { animeApi, reviewApi } from '../../api/client';
import { retryUnlessClientError } from '../../api/queries/retry';

vi.mock('../../api/client', () => ({
    animeApi: {
        getBySlug: vi.fn(),
        getCharacters: vi.fn(),
        getStaff: vi.fn(),
        getWatchEpisodes: vi.fn(),
        getEpisodeRatings: vi.fn(),
        getRecommendations: vi.fn(),
    },
    favoriteApi: {
        toggle: vi.fn(),
    },
    reviewApi: {
        getAll: vi.fn(),
        getStats: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        user: { id: 77, username: 'tester' },
    }),
}));

vi.mock('../../context/ThemeContext', () => ({
    useTheme: () => ({
        theme: 'default',
    }),
}));

vi.mock('../../components/StatusSelector', () => ({
    default: ({ onUpdate }) => (
        <button data-testid="status-update-trigger" onClick={() => onUpdate?.({ id: 1, status: 'Watching' })}>
            Update Status
        </button>
    ),
}));

vi.mock('../../components/AnimeCard', () => ({
    default: ({ anime }) => <div data-testid="related-anime-card">{anime?.title || 'related'}</div>,
}));

vi.mock('../../components/ReviewCard', () => ({
    default: () => <div data-testid="review-card" />,
}));

vi.mock('../../components/ReviewForm', () => ({
    default: () => <div data-testid="review-form" />,
}));

vi.mock('../../components/ReviewSummary', () => ({
    default: () => <div data-testid="review-summary" />,
}));

vi.mock('../../components/StatsTab', () => ({
    default: () => <div data-testid="stats-tab" />,
}));

vi.mock('../../components/InformationBox', () => ({
    default: () => <div data-testid="information-box" />,
}));

vi.mock('../../components/FriendsWatching', () => ({
    default: () => <div data-testid="friends-watching" />,
}));

vi.mock('../../components/DetailTabs', () => ({
    OverviewTab: () => <div data-testid="overview-tab" />,
    CharactersTab: ({ characters = [], hasNextPage, onLoadMore }) => (
        <div data-testid="characters-tab">
            <span data-testid="characters-loaded-count">{characters.length}</span>
            {hasNextPage && (
                <button type="button" onClick={onLoadMore}>
                    Load More Characters
                </button>
            )}
        </div>
    ),
    StaffTab: ({ staff = [], hasNextPage, onLoadMore }) => (
        <div data-testid="staff-tab">
            <span data-testid="staff-loaded-count">{staff.length}</span>
            {hasNextPage && (
                <button type="button" onClick={onLoadMore}>
                    Load More Staff
                </button>
            )}
        </div>
    ),
    ThemesTab: () => <div data-testid="themes-tab" />,
}));

vi.mock('../../components/EpisodesTab', () => ({
    default: () => <div data-testid="watch-tab" />,
}));

vi.mock('../../components/skeletons', () => ({
    AnimeDetailSkeleton: () => <div data-testid="anime-detail-skeleton" />,
}));

vi.mock('../../components/common/AnimeMediaImage', () => ({
    default: ({ alt }) => <img data-testid="anime-media-image" alt={alt} />,
}));

const mockAnime = {
    id: 1,
    slug: 'frieren',
    title: "Frieren: Beyond Journey's End Season 2",
    title_jp: '葬送のフリーレン 第2期',
    cover_image: '/cover.jpg',
    banner_image: '/banner.jpg',
    episode_count: 12,
    duration_minutes: 24,
    anime_type: 'TV',
    rating: '8.9',
    review_count: 0,
    user_review: null,
    is_favorite: false,
    user_list_status: {
        id: 99,
        status: 'Watching',
        episodes_watched: 5,
    },
    genres: [{ id: 1, name: 'Adventure', slug: 'adventure' }],
    character_count: 0,
    staff_count: 0,
};

function createHarness(initialEntry = '/anime/frieren', queryDefaults = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: 0,
                gcTime: 0,
                ...queryDefaults,
            },
        },
    });

    const wrapper = ({ children }) => (
        <HelmetProvider>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <Routes>
                        <Route path="/anime/:slug/*" element={children} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </HelmetProvider>
    );

    return { queryClient, wrapper };
}

describe('AnimeDetail list update invalidation', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        animeApi.getBySlug.mockResolvedValue({ data: mockAnime });
        animeApi.getCharacters.mockResolvedValue({
            data: {
                count: 0,
                next: null,
                previous: null,
                results: [],
            },
        });
        animeApi.getStaff.mockResolvedValue({
            data: {
                count: 0,
                next: null,
                previous: null,
                results: [],
            },
        });
        animeApi.getWatchEpisodes.mockResolvedValue({
            data: {
                count: 1,
                next: null,
                previous: null,
                results: [
                    {
                        number: 1,
                        title: 'The Journey Begins',
                        aired: '2024-01-12',
                        thumbnail: 'https://img.anilist.co/episode-1.jpg',
                        crunchyroll_url: 'https://www.crunchyroll.com/watch/GEXAMPLE',
                        has_real_crunchyroll_url: true,
                    },
                ],
            },
        });
        animeApi.getEpisodeRatings.mockResolvedValue({
            data: [
                {
                    episode_number: 1,
                    average_rating: '4.50',
                    rating_count: 2,
                    user_rating: '4.5',
                },
            ],
        });
        animeApi.getRecommendations.mockResolvedValue({ data: [] });
        reviewApi.getAll.mockResolvedValue({ data: { results: [], count: 0, next: null } });
        reviewApi.getStats.mockResolvedValue({ data: { total_reviews: 0 } });
    });

    it('patches cached cards and invalidates list caches when status selector reports an update', async () => {
        const { queryClient, wrapper } = createHarness();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        // A Browse grid page that shows the same title (B20: patched, not refetched).
        const gridKey = ['anime', 'list', 'grid'];
        queryClient.setQueryDefaults(gridKey, { gcTime: Infinity });
        queryClient.setQueryData(gridKey, {
            results: [{ id: 1, user_list_status: null }, { id: 2, user_list_status: null }],
        });

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getAllByTestId('status-update-trigger').length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getAllByTestId('status-update-trigger')[0]);

        await waitFor(() => {
            expect(queryClient.getQueryData(['anime', 'frieren', 77])?.user_list_status).toEqual({
                id: 1,
                status: 'Watching',
            });

            const keys = invalidateSpy.mock.calls
                .map(([arg]) => JSON.stringify(arg?.queryKey))
                .filter(Boolean);

            expect(keys).not.toContain(JSON.stringify(['anime']));
            expect(queryClient.getQueryData(gridKey).results).toEqual([
                { id: 1, user_list_status: { id: 1, status: 'Watching' } },
                { id: 2, user_list_status: null },
            ]);
            expect(keys).toContain(JSON.stringify(['user', 'list', 'watching']));
            expect(keys).toContain(JSON.stringify(['lists']));
            expect(keys).toContain(JSON.stringify(['ownProfile']));
        });
    });

    it('renders the tab content for a direct tab route', async () => {
        const { wrapper } = createHarness('/anime/frieren/stats');

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getByTestId('stats-tab')).toBeInTheDocument();
        });

        expect(animeApi.getRecommendations).toHaveBeenCalledWith('frieren');
        expect(animeApi.getEpisodeRatings).toHaveBeenCalledWith('frieren');
        expect(animeApi.getCharacters).not.toHaveBeenCalled();
        expect(animeApi.getStaff).not.toHaveBeenCalled();
    });

    it('navigates to the tab route and fetches tab data when a tab link is clicked', async () => {
        const { wrapper } = createHarness();

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('link', { name: /characters/i }));

        await waitFor(() => {
            expect(screen.getByTestId('characters-tab')).toBeInTheDocument();
        });

        expect(animeApi.getCharacters).toHaveBeenCalledWith('frieren', {
            page: 1,
            page_size: 50,
        });
    });

    it('loads more character pages without fetching the full cast upfront', async () => {
        animeApi.getBySlug.mockResolvedValue({
            data: {
                ...mockAnime,
                character_count: 2,
            },
        });
        animeApi.getCharacters
            .mockResolvedValueOnce({
                data: {
                    count: 2,
                    next: 'http://testserver/api/anime/frieren/characters/?page=2&page_size=50',
                    previous: null,
                    results: [
                        { id: 1, character: { id: 1, name: 'Frieren' }, role: 'MAIN', voice_actor: null },
                    ],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    count: 2,
                    next: null,
                    previous: 'http://testserver/api/anime/frieren/characters/?page=1&page_size=50',
                    results: [
                        { id: 2, character: { id: 2, name: 'Fern' }, role: 'MAIN', voice_actor: null },
                    ],
                },
            });
        const { wrapper } = createHarness('/anime/frieren/characters');

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getByTestId('characters-loaded-count')).toHaveTextContent('1');
        });

        expect(screen.getByRole('link', { name: /characters/i }).textContent?.replace(/\s+/g, '').trim()).toBe('Characters2');

        fireEvent.click(screen.getByRole('button', { name: /load more characters/i }));

        await waitFor(() => {
            expect(screen.getByTestId('characters-loaded-count')).toHaveTextContent('2');
        });

        expect(animeApi.getCharacters).toHaveBeenNthCalledWith(1, 'frieren', {
            page: 1,
            page_size: 50,
        });
        expect(animeApi.getCharacters).toHaveBeenNthCalledWith(2, 'frieren', {
            page: 2,
            page_size: 50,
        });
    });

    it('renders the watch tab for a direct watch route without extra tab fetches', async () => {
        const { wrapper } = createHarness('/anime/frieren/watch');

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getByTestId('watch-tab')).toBeInTheDocument();
        });

        expect(animeApi.getWatchEpisodes).toHaveBeenCalledWith('frieren', {
            page: 1,
            page_size: 50,
        });
        expect(animeApi.getEpisodeRatings).toHaveBeenCalledWith('frieren');
        // The count settles once the watch preview resolves (before that it
        // falls back to the anime's episode_count).
        await waitFor(() => {
            const watchLink = screen.getByRole('link', { name: /watch/i });
            expect(watchLink.textContent?.replace(/\s+/g, '').trim()).toBe('Watch1');
        });
        expect(animeApi.getCharacters).not.toHaveBeenCalled();
        expect(animeApi.getStaff).not.toHaveBeenCalled();
    });

    it('does not fallback to anime episode_count when watch episodes API count is zero', async () => {
        animeApi.getWatchEpisodes.mockResolvedValueOnce({
            data: {
                count: 0,
                next: null,
                previous: null,
                results: [],
            },
        });
        animeApi.getEpisodeRatings.mockResolvedValueOnce({ data: [] });
        const { wrapper } = createHarness('/anime/frieren/watch');

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getByTestId('watch-tab')).toBeInTheDocument();
        });

        await waitFor(() => {
            const watchLink = screen.getByRole('link', { name: /watch/i });
            expect(watchLink.textContent?.replace(/\s+/g, '').trim()).toBe('Watch');
        });
    });

    it('fetches only the 4-episode preview on Overview, not the 50-episode Watch page', async () => {
        const { wrapper } = createHarness();

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(animeApi.getWatchEpisodes).toHaveBeenCalledWith('frieren', { page: 1, page_size: 4 });
        });
        expect(animeApi.getWatchEpisodes).toHaveBeenCalledTimes(1);
        expect(animeApi.getWatchEpisodes).not.toHaveBeenCalledWith('frieren', expect.objectContaining({ page_size: 50 }));
    });
});

describe('AnimeDetail sidebar recommendations (B18)', () => {
    const originalObserver = window.IntersectionObserver;
    let observers;

    beforeEach(() => {
        vi.clearAllMocks();
        observers = [];
        animeApi.getBySlug.mockResolvedValue({ data: mockAnime });
        animeApi.getWatchEpisodes.mockResolvedValue({ data: { count: 0, results: [] } });
        animeApi.getRecommendations.mockResolvedValue({ data: [] });
        reviewApi.getAll.mockResolvedValue({ data: { results: [], count: 0, next: null } });
        reviewApi.getStats.mockResolvedValue({ data: { total_reviews: 0 } });
    });

    afterEach(() => {
        window.IntersectionObserver = originalObserver;
    });

    it('waits until the sidebar is about to show', async () => {
        window.IntersectionObserver = class {
            constructor(callback, options) {
                this.callback = callback;
                this.options = options;
                observers.push(this);
            }
            observe(element) { this.element = element; }
            disconnect() {}
            unobserve() {}
        };
        const { wrapper } = createHarness();

        render(<AnimeDetail />, { wrapper });

        await screen.findByTestId('overview-tab');
        const sidebarObserver = observers.find((observer) => observer.options?.rootMargin);
        expect(sidebarObserver).toBeDefined();
        expect(animeApi.getRecommendations).not.toHaveBeenCalled();

        act(() => {
            sidebarObserver.callback([{ isIntersecting: true, target: sidebarObserver.element }]);
        });

        await waitFor(() => {
            expect(animeApi.getRecommendations).toHaveBeenCalledWith('frieren');
        });
    });

    it('fetches straight away where IntersectionObserver is missing', async () => {
        delete window.IntersectionObserver;
        const { wrapper } = createHarness();

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(animeApi.getRecommendations).toHaveBeenCalledWith('frieren');
        });
    });
});

describe('AnimeDetail head tags (B21)', () => {
    const headContent = (selector, attribute = 'content') =>
        document.head.querySelector(selector)?.getAttribute(attribute);
    const jsonLd = () => JSON.parse(document.head.querySelector('script[type="application/ld+json"]')?.textContent || 'null');

    beforeEach(() => {
        vi.clearAllMocks();
        animeApi.getWatchEpisodes.mockResolvedValue({ data: { count: 0, results: [] } });
        animeApi.getRecommendations.mockResolvedValue({ data: [] });
        reviewApi.getAll.mockResolvedValue({ data: { results: [], count: 0, next: null } });
        reviewApi.getStats.mockResolvedValue({ data: { total_reviews: 0 } });
    });

    it('writes a canonical, an absolute og:image, a plain-text description and TVSeries JSON-LD', async () => {
        animeApi.getBySlug.mockResolvedValue({
            data: {
                ...mockAnime,
                synopsis: `<p>Frieren &amp; Fern <i>travel</i> north.</p><br>${'x'.repeat(300)}`,
            },
        });
        const { wrapper } = createHarness();

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(headContent('link[rel="canonical"]', 'href')).toBe('https://anishows.com/anime/frieren');
        });
        expect(headContent('meta[property="og:image"]')).toBe('https://anishows.com/cover.jpg');
        expect(headContent('meta[property="og:type"]')).toBe('video.tv_show');
        const description = headContent('meta[name="description"]');
        expect(description.startsWith('Frieren & Fern travel north.')).toBe(true);
        expect(description).not.toMatch(/[<>]/);
        expect(description.length).toBeLessThanOrEqual(160);
        expect(document.title).toBe("Frieren: Beyond Journey's End Season 2 | AniShows");
        expect(jsonLd()).toMatchObject({
            '@type': 'TVSeries',
            name: "Frieren: Beyond Journey's End Season 2",
            url: 'https://anishows.com/anime/frieren',
            image: 'https://anishows.com/cover.jpg',
        });
    });

    it('declares a movie as a Movie', async () => {
        animeApi.getBySlug.mockResolvedValue({
            data: { ...mockAnime, slug: 'frieren-movie', anime_type: 'Movie' },
        });
        const { wrapper } = createHarness('/anime/frieren-movie');

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(headContent('meta[property="og:type"]')).toBe('video.movie');
        });
        expect(jsonLd()?.['@type']).toBe('Movie');
    });

    it('marks a missing anime noindex', async () => {
        animeApi.getBySlug.mockRejectedValue(Object.assign(new Error('HTTP 404'), { response: { status: 404 } }));
        const { wrapper } = createHarness('/anime/missing');

        render(<AnimeDetail />, { wrapper });

        await screen.findByRole('heading', { name: 'Anime not found' });
        await waitFor(() => {
            expect(headContent('meta[name="robots"]')).toBe('noindex, nofollow');
        });
    });
});

describe('AnimeDetail with the app retry policy (smoke finding S-2)', () => {
    const appRetry = { retry: retryUnlessClientError, retryDelay: 0 };
    const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

    beforeEach(() => {
        vi.clearAllMocks();
        animeApi.getRecommendations.mockResolvedValue({ data: [] });
        reviewApi.getAll.mockResolvedValue({ data: { results: [] } });
        reviewApi.getStats.mockResolvedValue({ data: {} });
    });

    it('asks for a missing slug once, then shows Not found', async () => {
        animeApi.getBySlug.mockRejectedValue(httpError(404));
        const { wrapper } = createHarness('/anime/missing', appRetry);

        render(<AnimeDetail />, { wrapper });

        expect(await screen.findByRole('heading', { name: 'Anime not found' })).toBeInTheDocument();
        expect(animeApi.getBySlug).toHaveBeenCalledTimes(1);
    });

    it('retries a server error once before showing the error state', async () => {
        animeApi.getBySlug.mockRejectedValue(httpError(500));
        const { wrapper } = createHarness('/anime/frieren', appRetry);

        render(<AnimeDetail />, { wrapper });

        expect(await screen.findByText('Couldn’t load this anime')).toBeInTheDocument();
        expect(animeApi.getBySlug).toHaveBeenCalledTimes(2);
    });
});
