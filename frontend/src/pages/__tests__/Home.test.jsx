import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Home from '../Home';
import { animeApi, listApi, recommendationsApi } from '../../api/client';

const authState = {
    isAuthenticated: false,
    loading: false,
};

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => authState,
}));

vi.mock('../../api/client', () => ({
    animeApi: {
        getTrending: vi.fn(),
        getTopRated: vi.fn(() => Promise.resolve({ data: [] })),
        getSchedule: vi.fn(() => Promise.resolve({ data: { days: {} } })),
    },
    listApi: {
        add: vi.fn(),
        getAll: vi.fn(),
    },
    recommendationsApi: {
        getAll: vi.fn(),
        dismiss: vi.fn(),
    },
}));

vi.mock('../../components/SEO', () => ({
    default: () => <div data-testid="seo-home" />,
}));

vi.mock('../../components/AnimeCard', () => ({
    default: ({ anime, metaText }) => (
        <div data-testid="anime-card">
            <span>{anime.title}</span>
            {metaText ? <span>{metaText}</span> : null}
        </div>
    ),
    AnimeCardSkeleton: () => <div data-testid="anime-card-skeleton">loading</div>,
}));

vi.mock('../../components/common/AnimeMediaImage', () => ({
    default: ({ alt }) => <img alt={alt} data-testid="anime-media-image" />,
}));

const mockAnime = {
    id: 1,
    title: 'Demon Slayer',
    slug: 'demon-slayer',
    rating: '8.7',
    anime_type: 'TV',
    start_date: '2024-01-01',
    genres: [{ name: 'Action' }],
    synopsis: 'A test synopsis',
    user_list_status: null,
};

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: 0,
                gcTime: 0,
            },
        },
    });

    return ({ children }) => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={children} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
};

describe('Home', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.isAuthenticated = false;
        authState.loading = false;

        animeApi.getTrending.mockResolvedValue({ data: [mockAnime] });
    });

    it('renders guest intro hero for non-authenticated users', async () => {
        render(<Home />, { wrapper: createWrapper() });

        expect(
            screen.getByRole('heading', { level: 1, name: /Never lose your place/ }),
        ).toBeInTheDocument();
        const registerLinks = screen.getAllByRole('link', { name: /create an account/i });
        expect(registerLinks.length).toBeGreaterThan(0);
        expect(registerLinks[0]).toHaveAttribute('href', '/register');
        // The header offers Sign in; the hero does not ask twice.
        expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /import from mal or anilist/i })).toHaveAttribute('href', '/import');
        expect(screen.getByRole('heading', { name: 'Airing today' })).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getAllByText('Demon Slayer').length).toBeGreaterThan(0);
        });
    });

    it('opens on Continue for members, not a trending carousel (L2)', async () => {
        authState.isAuthenticated = true;
        authState.user = { username: 'megumin' };
        listApi.getAll.mockResolvedValue({ data: { results: [] } });

        render(<Home />, { wrapper: createWrapper() });

        expect(screen.getByRole('heading', { level: 1, name: 'megumin' })).toBeInTheDocument();
        expect(await screen.findByRole('region', { name: 'Continue watching' })).toBeInTheDocument();
        expect(await screen.findByText(/Nothing in progress/)).toBeInTheDocument();
        // One primary action and one plain link, no "or" between them.
        expect(screen.getByRole('link', { name: 'Find something to watch' })).toHaveClass('btn-primary');
        expect(screen.getByRole('link', { name: 'Import a list' })).toHaveAttribute('href', '/import');
        expect(screen.queryByText('or')).not.toBeInTheDocument();
        expect(screen.queryByText('View Details')).not.toBeInTheDocument();
    });

    it('shows guest intro hero while auth is loading', () => {
        authState.loading = true;
        authState.isAuthenticated = false;

        render(<Home />, { wrapper: createWrapper() });

        expect(
            screen.getByRole('heading', { level: 1, name: /Never lose your place/ }),
        ).toBeInTheDocument();
    });

    it('still renders guest trending section when guest hero is static', async () => {
        render(<Home />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(animeApi.getTrending).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('Trending now')).toBeInTheDocument();
    });
});

describe('Home - Continue and the airing ribbon (members)', () => {
    const HOUR = 60 * 60 * 1000;
    const inFuture = (ms) => new Date(Date.now() + ms).toISOString();
    const entry = (id, title, nextAiringDate, status = 'Watching', episode = 5) => ({
        id,
        title,
        slug: `show-${id}`,
        next_airing_date: nextAiringDate,
        next_airing_episode: episode,
        user_list_status: status ? { status } : null,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        authState.isAuthenticated = true;
        authState.loading = false;
        animeApi.getTrending.mockResolvedValue({ data: [mockAnime] });
        recommendationsApi.getAll.mockResolvedValue({ data: [] });
    });

    afterEach(() => {
        authState.isAuthenticated = false;
    });

    it('puts shows with a new episode first, then what airs soonest, with +1 on each', async () => {
        listApi.getAll.mockResolvedValue({
            data: {
                results: [
                    { id: 11, status: 'Watching', episodes_watched: 3, score: 0, updated_at: '2026-11-20T10:00:00Z', anime: { id: 1, slug: 'soon', title: 'Up To Date', episode_count: 12, next_airing_episode: 4, next_airing_date: inFuture(2 * HOUR + 21 * 60 * 1000) } },
                    { id: 12, status: 'Watching', episodes_watched: 7, score: 0, updated_at: '2026-11-19T10:00:00Z', anime: { id: 2, slug: 'ready', title: 'Behind By One', episode_count: 12, next_airing_episode: 9, next_airing_date: inFuture(26 * HOUR) } },
                    { id: 13, status: 'Watching', episodes_watched: 12, score: 0, updated_at: '2026-11-18T10:00:00Z', anime: { id: 3, slug: 'done', title: 'All Watched', episode_count: 12 } },
                ],
            },
        });

        render(<Home />, { wrapper: createWrapper() });

        const section = await screen.findByRole('region', { name: 'Continue watching' });
        await within(section).findByText('Behind By One');
        const titles = within(section).getAllByRole('link').map((link) => link.textContent).filter((text) => ['Behind By One', 'All Watched', 'Up To Date'].includes(text));
        expect(titles).toEqual(['Behind By One', 'All Watched', 'Up To Date']);
        expect(within(section).getByText('Episode 8 is out')).toBeInTheDocument();
        expect(within(section).getAllByText(/^Episode 4 in 2h 2[01]m$/).length).toBeGreaterThan(0);
        // The left column lists what airs tonight (or the next airing show).
        expect(within(section).getByRole('heading', { name: 'Tonight' })).toBeInTheDocument();
        expect(within(section).getByText('1 of your shows has a new episode waiting.')).toBeInTheDocument();
        expect(within(section).getByRole('button', { name: 'One episode more of Behind By One' })).toBeInTheDocument();
        // A finished show asks for a score instead of +1.
        expect(within(section).getByRole('radiogroup', { name: 'Score All Watched' })).toBeInTheDocument();
    });

    it('shows your listed shows across the week in the airing ribbon', async () => {
        listApi.getAll.mockResolvedValue({ data: { results: [] } });
        animeApi.getSchedule.mockResolvedValue({
            data: {
                days: {
                    monday: [
                        entry(4, 'Three Hours Away', inFuture(3 * HOUR), 'Watching', 5),
                        entry(6, 'Not Listed', inFuture(HOUR), null),
                    ],
                },
            },
        });

        render(<Home />, { wrapper: createWrapper() });

        const ribbon = await screen.findByRole('region', { name: 'Your week' });
        expect(await within(ribbon).findByText('Three Hours Away')).toBeInTheDocument();
        expect(within(ribbon).queryByText('Not Listed')).not.toBeInTheDocument();
    });

    it('hides the ribbon when nothing on the list airs this week', async () => {
        listApi.getAll.mockResolvedValue({ data: { results: [] } });
        animeApi.getSchedule.mockResolvedValue({
            data: { days: { monday: [entry(6, 'Not Listed', inFuture(HOUR), null)] } },
        });

        render(<Home />, { wrapper: createWrapper() });

        await waitFor(() => expect(animeApi.getSchedule).toHaveBeenCalledTimes(1));
        await screen.findByText('Trending now');
        expect(screen.queryByRole('region', { name: 'Your week' })).not.toBeInTheDocument();
    });

    describe('after an episode aired but before the API synced it', () => {
        // Saturday 2026-11-21 10:35 UTC; Apothecary Diaries ep 9 aired at 10:04.
        const NOW = new Date('2026-11-21T10:35:00Z');
        const apothecary = {
            id: 21, slug: 'apothecary', title: 'The Apothecary Diaries', episode_count: 24,
            next_airing_episode: 9, next_airing_date: '2026-11-21T10:04:00Z',
            user_list_status: { status: 'Watching' },
        };
        const later = {
            id: 22, slug: 'later', title: 'Later Today', episode_count: 12,
            next_airing_episode: 4, next_airing_date: '2026-11-21T12:43:00Z',
            user_list_status: { status: 'Watching' },
        };

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            authState.user = { username: 'megumin', preferred_timezone: 'UTC' };
        });
        afterEach(() => {
            vi.useRealTimers();
            authState.user = { username: 'megumin' };
        });

        it('says the episode is out in Continue and Your week; Tonight lists what is still to come', async () => {
            listApi.getAll.mockResolvedValue({
                data: {
                    results: [
                        { id: 31, status: 'Watching', episodes_watched: 8, score: 0, updated_at: '2026-11-20T10:00:00Z', anime: apothecary },
                        { id: 32, status: 'Watching', episodes_watched: 3, score: 0, updated_at: '2026-11-20T09:00:00Z', anime: later },
                    ],
                },
            });
            animeApi.getSchedule.mockResolvedValue({ data: { days: { saturday: [apothecary, later] } } });

            render(<Home />, { wrapper: createWrapper() });

            const section = await screen.findByRole('region', { name: 'Continue watching' });
            expect(await within(section).findByText('Episode 9 is out')).toBeInTheDocument();
            expect(within(section).getByText('1 of your shows has a new episode waiting.')).toBeInTheDocument();
            // Tonight: in time order, the aired one included.
            // Already out: named in Continue, not again under Tonight.
            expect(within(section).queryByText('10:04 · Episode 9 is out')).not.toBeInTheDocument();
            expect(within(section).getByText('12:43 · Episode 4 · in 2h 8m')).toBeInTheDocument();
            expect(within(section).queryByText(/Nothing from your list airs today/)).not.toBeInTheDocument();

            const week = await screen.findByRole('region', { name: 'Your week' });
            const today = await within(week).findByRole('region', { name: /Today/ });
            expect(within(today).getByText('The Apothecary Diaries')).toBeInTheDocument();
            expect(within(today).getByText('Episode 9 · out')).toBeInTheDocument();
            expect(within(today).getByText('Episode 4')).toBeInTheDocument();
        });

        it('does not repeat a Continue show as Next up when nothing airs today', async () => {
            const sunday = { ...later, next_airing_date: '2026-11-22T15:43:00Z' };
            listApi.getAll.mockResolvedValue({
                data: { results: [{ id: 32, status: 'Watching', episodes_watched: 3, score: 0, updated_at: '2026-11-20T09:00:00Z', anime: sunday }] },
            });
            animeApi.getSchedule.mockResolvedValue({ data: { days: {} } });

            render(<Home />, { wrapper: createWrapper() });

            const section = await screen.findByRole('region', { name: 'Continue watching' });
            // Its Continue row already says when the next episode comes, so
            // neither Tonight nor a Next up line repeats it.
            await within(section).findByText('Later Today');
            expect(within(section).queryByRole('link', { name: /^Next up/ })).not.toBeInTheDocument();
            expect(within(section).queryByRole('heading', { name: 'Tonight' })).not.toBeInTheDocument();
        });

        it('fills the guest panel with upcoming episodes and leaves out aired ones', async () => {
            authState.isAuthenticated = false;
            window.localStorage.setItem('AniShows.userTimezonePreference', 'UTC');
            animeApi.getSchedule.mockResolvedValue({
                data: {
                    days: {
                        saturday: [
                            { ...apothecary, user_list_status: null },
                            { id: 40, slug: 'tba', title: 'No Time Yet', broadcast_day: 'Saturday', next_airing_date: null },
                        ],
                        sunday: [{ ...later, id: 41, title: 'Sunday Show', next_airing_date: '2026-11-22T09:43:00Z', user_list_status: null }],
                    },
                },
            });

            render(<Home />, { wrapper: createWrapper() });

            expect(await screen.findByText('Tomorrow 09:43')).toBeInTheDocument();
            expect(screen.queryByText('Aired 10:04')).not.toBeInTheDocument();
            expect(screen.queryByText('Time TBA')).not.toBeInTheDocument();
            window.localStorage.removeItem('AniShows.userTimezonePreference');
        });
    });

    it('is not requested for guests', async () => {
        authState.isAuthenticated = false;

        render(<Home />, { wrapper: createWrapper() });

        await screen.findByText('Trending now');
        // Guests see today's airings on the landing page, but no personal week.
        expect(screen.queryByRole('region', { name: 'Your week' })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Your week' })).not.toBeInTheDocument();
    });
});

describe('Home - Recommended for You', () => {
    const rec = (id, title, extra = {}) => ({
        id: id * 10,
        anime: { id, title, slug: `rec-${id}` },
        reason: 'genre_match',
        reason_metadata: { matched_genres: ['Action'] },
        ...extra,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        authState.isAuthenticated = true;
        authState.loading = false;
        animeApi.getTrending.mockResolvedValue({ data: [mockAnime] });
        animeApi.getSchedule.mockResolvedValue({ data: { days: {} } });
    });

    afterEach(() => {
        authState.isAuthenticated = false;
    });

    it('dismisses a card by keyboard and keeps it gone', async () => {
        recommendationsApi.getAll.mockResolvedValue({ data: [rec(1, 'Pick One'), rec(2, 'Pick Two')] });
        recommendationsApi.dismiss.mockResolvedValue({ data: {} });
        const user = userEvent.setup();

        render(<Home />, { wrapper: createWrapper() });

        const button = await screen.findByRole('button', { name: 'Not interested in Pick One' });
        expect(screen.getByText('Based on your love for Action')).toBeInTheDocument();
        button.focus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(screen.queryByText('Pick One')).not.toBeInTheDocument());
        expect(recommendationsApi.dismiss).toHaveBeenCalledWith(1);
        expect(screen.getByText('Pick Two')).toBeInTheDocument();
        // Focus moved to the next card's button instead of falling to <body>.
        expect(screen.getByRole('button', { name: 'Not interested in Pick Two' })).toHaveFocus();
        expect(recommendationsApi.getAll).toHaveBeenCalledTimes(1);
    });

    it('puts the card back when dismissing fails', async () => {
        recommendationsApi.getAll.mockResolvedValue({ data: [rec(1, 'Pick One'), rec(2, 'Pick Two')] });
        let rejectDismiss;
        recommendationsApi.dismiss.mockReturnValue(new Promise((_, reject) => { rejectDismiss = reject; }));

        render(<Home />, { wrapper: createWrapper() });

        fireEvent.click(await screen.findByRole('button', { name: 'Not interested in Pick One' }));
        await waitFor(() => expect(screen.queryByText('Pick One')).not.toBeInTheDocument());

        rejectDismiss(Object.assign(new Error('Server error'), { response: { status: 500 } }));

        expect(await screen.findByText('Pick One')).toBeInTheDocument();
    });

    it('does not claim to know the taste of a user who only has trending picks', async () => {
        recommendationsApi.getAll.mockResolvedValue({
            data: [
                rec(1, 'Trending One', { reason: 'trending', reason_metadata: { matched_genres: ['Action'] } }),
                rec(2, 'Trending Two', { reason: 'trending', reason_metadata: {} }),
            ],
        });

        render(<Home />, { wrapper: createWrapper() });

        await screen.findByText('Trending One');
        expect(screen.getByText('Popular right now while we learn your taste')).toBeInTheDocument();
        expect(screen.queryByText(/Based on your love for/)).not.toBeInTheDocument();
    });
});
