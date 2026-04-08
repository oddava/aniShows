import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowseRowMode from './BrowseRowMode';

const mockGetAll = vi.fn();

vi.mock('../../api/client', () => ({
    animeApi: {
        getAll: (...args) => mockGetAll(...args),
    },
}));

vi.mock('./CategoryRow', () => ({
    default: ({ title, animeList = [], viewAllLink = '' }) => (
        <section data-testid={title}>
            <h2>{title}</h2>
            <div>{animeList.map((anime) => anime.title).join('|')}</div>
            <div data-testid={`${title}-link`}>{viewAllLink}</div>
        </section>
    ),
}));

describe('BrowseRowMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const now = new Date();
        const month = now.getMonth();
        const year = now.getFullYear();
        let currentSeason = 'winter';
        if (month >= 3 && month <= 5) currentSeason = 'spring';
        else if (month >= 6 && month <= 8) currentSeason = 'summer';
        else if (month >= 9 && month <= 11) currentSeason = 'fall';

        mockGetAll.mockImplementation((params) => {
            if (params.sort === 'trending') {
                return Promise.resolve({
                    data: {
                        results: [
                            { id: 1, title: 'Trend 1' },
                            { id: 2, title: 'Trend 2' },
                            { id: 3, title: 'Trend 3' },
                            { id: 4, title: 'Trend 4' },
                            { id: 5, title: 'Trend 5' },
                            { id: 6, title: 'Trend 6' },
                        ],
                    },
                });
            }

            if (params.sort === 'popular' && params.season === currentSeason && params.year === year) {
                return Promise.resolve({
                    data: {
                        results: [
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
                });
            }

            return Promise.resolve({ data: { results: [] } });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the seasonal row aligned with the actual seasonal popularity ordering', async () => {
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
            expect(screen.getByTestId('Popular This Season')).toHaveTextContent('Trend 1');
        });

        expect(screen.getByTestId('Popular This Season')).toHaveTextContent('Trend 2');
        expect(screen.getByTestId('Popular This Season')).toHaveTextContent('Season 9');
        expect(screen.getByTestId('Popular This Season-link')).toHaveTextContent('season=');
        expect(screen.getByTestId('Popular This Season-link')).not.toHaveTextContent('exclude_ids=');
    });
});
