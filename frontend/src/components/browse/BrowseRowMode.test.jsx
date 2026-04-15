import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowseRowMode from './BrowseRowMode';

const mockGetBrowseRows = vi.fn();

vi.mock('../../api/client', () => ({
    animeApi: {
        getBrowseRows: (...args) => mockGetBrowseRows(...args),
    },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: null }),
}));

vi.mock('./CategoryRow', () => ({
    default: ({ title, animeList = [], viewAllLink = '', eagerCount = 0 }) => (
        <section data-testid={title}>
            <h2>{title}</h2>
            <div>{animeList.map((anime) => anime.title).join('|')}</div>
            <div data-testid={`${title}-link`}>{viewAllLink}</div>
            <div data-testid={`${title}-eager-count`}>{eagerCount}</div>
        </section>
    ),
}));

describe('BrowseRowMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetBrowseRows.mockResolvedValue({
            data: [
                {
                    key: 'trending',
                    title: 'Trending Now',
                    browse_params: { sort: 'trending' },
                    anime_list: [
                        { id: 1, title: 'Trend 1' },
                        { id: 2, title: 'Trend 2' },
                        { id: 3, title: 'Trend 3' },
                        { id: 4, title: 'Trend 4' },
                        { id: 5, title: 'Trend 5' },
                        { id: 6, title: 'Trend 6' },
                    ],
                },
                {
                    key: 'popular-season',
                    title: 'Popular This Season',
                    browse_params: { season: 'spring', year: '2026', sort: 'popular' },
                    anime_list: [
                        { id: 1, title: 'Trend 1' },
                        { id: 2, title: 'Trend 2' },
                        { id: 3, title: 'Trend 3' },
                        { id: 7, title: 'Season 7' },
                        { id: 8, title: 'Season 8' },
                        { id: 9, title: 'Season 9' },
                        { id: 10, title: 'Season 10' },
                        { id: 11, title: 'Season 11' },
                        { id: 12, title: 'Season 12' },
                    ],
                },
                {
                    key: 'all-time',
                    title: 'All Time Popular',
                    browse_params: { sort: 'popular', shelf: 'all-time' },
                    anime_list: [
                        { id: 13, title: 'Popular 13' },
                        { id: 14, title: 'Popular 14' },
                    ],
                },
            ],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the seasonal row filled with unique titles after removing trending duplicates', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                },
            },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <BrowseRowMode />
            </QueryClientProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('Trending Now')).toHaveTextContent('Trend 1');
            expect(screen.getByTestId('Popular This Season')).toHaveTextContent('Season 7');
        });

        expect(screen.getByTestId('Popular This Season')).not.toHaveTextContent('Trend 1');
        expect(screen.getByTestId('Popular This Season')).not.toHaveTextContent('Trend 2');
        expect(screen.getByTestId('Popular This Season')).toHaveTextContent('Season 9');
        expect(screen.getByTestId('Popular This Season-link')).toHaveTextContent('season=');
        expect(screen.getByTestId('All Time Popular-link')).toHaveTextContent('shelf=all-time');
        expect(screen.getByTestId('Trending Now-eager-count')).toHaveTextContent('6');
        expect(screen.getByTestId('Popular This Season-eager-count')).toHaveTextContent('0');
    });

    it('hides a shelf when every card is already shown in an earlier row', async () => {
        mockGetBrowseRows.mockResolvedValue({
            data: [
                {
                    key: 'trending',
                    title: 'Trending Now',
                    browse_params: { sort: 'trending' },
                    anime_list: Array.from({ length: 6 }, (_, index) => ({
                        id: index + 1,
                        title: `Trend ${index + 1}`,
                    })),
                },
                {
                    key: 'popular-season',
                    title: 'Popular This Season',
                    browse_params: { season: 'spring', year: '2026', sort: 'popular' },
                    anime_list: Array.from({ length: 6 }, (_, index) => ({
                        id: index + 1,
                        title: `Trend ${index + 1}`,
                    })),
                },
                {
                    key: 'top-rated',
                    title: 'Top Rated',
                    browse_params: { sort: 'rating' },
                    anime_list: Array.from({ length: 6 }, (_, index) => ({
                        id: index + 101,
                        title: `Top ${index + 1}`,
                    })),
                },
            ],
        });

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                },
            },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <BrowseRowMode />
            </QueryClientProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('Trending Now')).toHaveTextContent('Trend 1');
        });

        expect(screen.queryByTestId('Popular This Season')).not.toBeInTheDocument();
    });
});
