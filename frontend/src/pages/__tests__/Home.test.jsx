import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Home from '../Home';
import { animeApi, recommendationsApi } from '../../api/client';

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

    it('renders member carousel hero for authenticated users', async () => {
        authState.isAuthenticated = true;

        render(<Home />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText('View Details')).toBeInTheDocument();
        });

        expect(screen.getByText('Add to List')).toBeInTheDocument();
        // The banner is decorative (the title is the heading), so it has empty alt text.
        expect(screen.getAllByTestId('anime-media-image').length).toBeGreaterThan(0);
        expect(screen.getByRole('heading', { level: 1, name: 'Demon Slayer' })).toBeInTheDocument();
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

describe('Home - Up next (members)', () => {
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

    it('lists Watching shows airing within 7 days, soonest first', async () => {
        animeApi.getSchedule.mockResolvedValue({
            data: {
                days: {
                    monday: [
                        entry(1, 'Two Days Away', inFuture(2 * 24 * HOUR + 5 * 60 * 1000), 'Watching', 8),
                        entry(2, 'Planned Show', inFuture(HOUR), 'Plan to Watch'),
                        entry(3, 'Ten Days Away', inFuture(10 * 24 * HOUR)),
                    ],
                    tuesday: [
                        entry(4, 'Three Hours Away', inFuture(3 * HOUR + 5 * 60 * 1000), 'Watching', 5),
                        entry(5, 'Already Aired', new Date(Date.now() - HOUR).toISOString()),
                        entry(6, 'Not Listed', inFuture(HOUR), null),
                    ],
                },
            },
        });

        render(<Home />, { wrapper: createWrapper() });

        const shelf = await screen.findByRole('region', { name: 'Up next' });
        const cards = within(shelf).getAllByTestId('anime-card');
        expect(cards.map((card) => card.firstChild.textContent)).toEqual(['Three Hours Away', 'Two Days Away']);
        expect(within(shelf).getByText('EP 5 · in 3h')).toBeInTheDocument();
        expect(within(shelf).getByText('EP 8 · in 2 days')).toBeInTheDocument();

        // Above Currently Watching / Trending in the page order.
        const trending = screen.getByRole('region', { name: 'Trending Now' });
        expect(shelf.compareDocumentPosition(trending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is hidden when nothing on the list airs soon', async () => {
        animeApi.getSchedule.mockResolvedValue({
            data: { days: { monday: [entry(2, 'Planned Show', inFuture(HOUR), 'Plan to Watch')] } },
        });

        render(<Home />, { wrapper: createWrapper() });

        await waitFor(() => expect(animeApi.getSchedule).toHaveBeenCalledTimes(1));
        await screen.findByText('Trending Now');
        expect(screen.queryByRole('region', { name: 'Up next' })).not.toBeInTheDocument();
    });

    it('is not requested for guests', async () => {
        authState.isAuthenticated = false;

        render(<Home />, { wrapper: createWrapper() });

        await screen.findByText('Trending Now');
        expect(animeApi.getSchedule).not.toHaveBeenCalled();
        expect(screen.queryByRole('region', { name: 'Up next' })).not.toBeInTheDocument();
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
