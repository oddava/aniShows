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
            screen.getByText('Discover, Track, and Share Your Anime Journey'),
        ).toBeInTheDocument();
        const registerLinks = screen.getAllByRole('link', { name: /create free account/i });
        expect(registerLinks.length).toBeGreaterThan(0);
        expect(registerLinks[0]).toHaveAttribute('href', '/register');
        expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');

        await waitFor(() => {
            expect(screen.getAllByText('Demon Slayer').length).toBeGreaterThan(0);
        });
    });

    it('opens on Continue for members, not a trending carousel (L2)', async () => {
        authState.isAuthenticated = true;
        authState.user = { username: 'megumin' };
        listApi.getAll.mockResolvedValue({ data: { results: [] } });

        render(<Home />, { wrapper: createWrapper() });

        expect(screen.getByRole('heading', { level: 1, name: 'Welcome back, megumin' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Continue' })).toBeInTheDocument();
        expect(await screen.findByText('Nothing in progress')).toBeInTheDocument();
        expect(screen.queryByText('View Details')).not.toBeInTheDocument();
    });

    it('shows guest intro hero while auth is loading', () => {
        authState.loading = true;
        authState.isAuthenticated = false;

        render(<Home />, { wrapper: createWrapper() });

        expect(
            screen.getByText('Discover, Track, and Share Your Anime Journey'),
        ).toBeInTheDocument();
    });

    it('still renders guest trending section when guest hero is static', async () => {
        render(<Home />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(animeApi.getTrending).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('Trending Now')).toBeInTheDocument();
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

        const section = await screen.findByRole('region', { name: 'Continue' });
        await within(section).findByText('Behind By One');
        const titles = within(section).getAllByRole('link').map((link) => link.textContent).filter((text) => text && text !== 'My List');
        expect(titles).toEqual(['Behind By One', 'All Watched', 'Up To Date']);
        expect(within(section).getByText('EP 8 is out')).toBeInTheDocument();
        expect(within(section).getByText(/^2h 2[01]m$/)).toBeInTheDocument();
        expect(within(section).getByText('1 show has a new episode waiting.')).toBeInTheDocument();
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
        await screen.findByText('Trending Now');
        expect(screen.queryByRole('region', { name: 'Your week' })).not.toBeInTheDocument();
    });

    it('is not requested for guests', async () => {
        authState.isAuthenticated = false;

        render(<Home />, { wrapper: createWrapper() });

        await screen.findByText('Trending Now');
        expect(animeApi.getSchedule).not.toHaveBeenCalled();
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
