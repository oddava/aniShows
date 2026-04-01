import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AnimeDetail from '../AnimeDetail';
import { animeApi, reviewApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    animeApi: {
        getBySlug: vi.fn(),
        getCharacters: vi.fn(),
        getStaff: vi.fn(),
        getRelated: vi.fn(),
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

vi.mock('../../components/CharacterModal', () => ({
    default: () => <div data-testid="character-modal" />,
}));

vi.mock('../../components/StaffModal', () => ({
    default: () => <div data-testid="staff-modal" />,
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

vi.mock('../../components/SEOHelmet', () => ({
    default: () => <div data-testid="seo-helmet" />,
}));

vi.mock('../../components/DetailTabs', () => ({
    OverviewTab: () => <div data-testid="overview-tab" />,
    CharactersTab: () => <div data-testid="characters-tab" />,
    StaffTab: () => <div data-testid="staff-tab" />,
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

function createHarness(initialEntry = '/anime/frieren') {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: 0,
                gcTime: 0,
            },
        },
    });

    const wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialEntry]}>
                <Routes>
                    <Route path="/anime/:slug/*" element={children} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );

    return { queryClient, wrapper };
}

describe('AnimeDetail list update invalidation', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        animeApi.getBySlug.mockResolvedValue({ data: mockAnime });
        animeApi.getCharacters.mockResolvedValue({ data: [] });
        animeApi.getStaff.mockResolvedValue({ data: [] });
        animeApi.getRelated.mockResolvedValue({ data: [] });
        reviewApi.getAll.mockResolvedValue({ data: { results: [], count: 0, next: null } });
        reviewApi.getStats.mockResolvedValue({ data: { total_reviews: 0 } });
    });

    it('invalidates anime/list caches when status selector reports an update', async () => {
        const { queryClient, wrapper } = createHarness();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        render(<AnimeDetail />, { wrapper });

        await waitFor(() => {
            expect(screen.getByTestId('status-update-trigger')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByTestId('status-update-trigger'));

        await waitFor(() => {
            const keys = invalidateSpy.mock.calls
                .map(([arg]) => JSON.stringify(arg?.queryKey))
                .filter(Boolean);

            expect(keys).toContain(JSON.stringify(['anime']));
            expect(keys).toContain(JSON.stringify(['anime', 'frieren']));
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

        expect(animeApi.getCharacters).toHaveBeenCalledWith('frieren');
    });
});
