import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Home from '../Home';
import { animeApi } from '../../api/client';

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
    },
    listApi: {
        add: vi.fn(),
        getAll: vi.fn(),
    },
    recommendationsApi: {
        getAll: vi.fn(),
    },
}));

vi.mock('../../components/SEO', () => ({
    default: () => <div data-testid="seo-home" />,
}));

vi.mock('../../components/AnimeCard', () => ({
    default: ({ anime }) => <div data-testid="anime-card">{anime.title}</div>,
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
            expect(screen.getByText('Play Now')).toBeInTheDocument();
        });

        expect(screen.getByText('Add to List')).toBeInTheDocument();
        expect(screen.getAllByAltText('Demon Slayer banner image').length).toBeGreaterThan(0);
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
