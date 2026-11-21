import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import useBrowseAnimeList, { keepPreviousUnlessNewSearch } from '../useBrowseAnimeList';

const animeApi = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock('../../../api/client', () => ({ animeApi }));
vi.mock('../../../hooks/usePrefetchAnime', () => ({ usePrefetchAnime: () => ({ prefetchNextPage: vi.fn() }) }));

const filtersFor = (search, sort = 'popular') => ({
    currentGenres: [], currentTags: [], currentSort: sort, currentSearch: search,
    currentTypes: '', currentStatuses: '', currentStudio: '', currentSeason: '', currentYear: '',
    currentExcludeIds: '', currentShelf: '', currentMinRating: '', currentMaxRating: '', currentSource: '',
    currentMinEpisodes: '', currentMaxEpisodes: '', currentMinDuration: '', currentMaxDuration: '',
    currentMinYear: '', currentMaxYear: '', isGridMode: true,
});

const page = (...titles) => ({ data: { results: titles.map((title, id) => ({ id, title })), next: null } });

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function setup(initialSearch) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return renderHook(
        ({ filters }) => useBrowseAnimeList({ filters, adultContentEnabled: false }),
        { wrapper, initialProps: { filters: filtersFor(initialSearch) } },
    );
}

beforeEach(() => {
    animeApi.getAll.mockReset();
    globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
});

describe('Browse search never shows the previous query’s results (B1)', () => {
    it('clears to loading on a new search instead of keeping the old grid', async () => {
        animeApi.getAll.mockResolvedValueOnce(page('Frieren', 'Frieren Season 2'));
        const { result, rerender } = setup('frieren');
        await waitFor(() => expect(result.current.allAnime).toHaveLength(2));

        const next = deferred();
        animeApi.getAll.mockReturnValueOnce(next.promise);
        rerender({ filters: filtersFor('naruto shipuden') });

        expect(result.current.allAnime).toEqual([]);
        expect(result.current.isLoading).toBe(true);

        await act(async () => { next.resolve(page('Naruto: Shippuden')); });
        await waitFor(() => expect(result.current.allAnime.map((a) => a.title)).toEqual(['Naruto: Shippuden']));
    });

    it('aborts the superseded request, so a late answer cannot land', async () => {
        const slow = deferred();
        let firstSignal;
        animeApi.getAll.mockImplementationOnce((params, signal) => {
            firstSignal = signal;
            return slow.promise;
        });
        const { result, rerender } = setup('fri');
        await waitFor(() => expect(animeApi.getAll).toHaveBeenCalledTimes(1));

        animeApi.getAll.mockResolvedValueOnce(page('Frieren'));
        rerender({ filters: filtersFor('frieren') });
        await waitFor(() => expect(result.current.allAnime.map((a) => a.title)).toEqual(['Frieren']));

        expect(firstSignal.aborted).toBe(true);
        await act(async () => { slow.resolve(page('Fruits Basket')); });
        expect(result.current.allAnime.map((a) => a.title)).toEqual(['Frieren']);
    });

    it('keeps the old grid (marked stale) for a sort change within the same search', () => {
        const previous = { pages: [] };
        const query = { queryKey: ['anime', 'list', '', '', 'popular', 'frieren'] };
        expect(keepPreviousUnlessNewSearch(previous, query, 'frieren')).toBe(previous);
        expect(keepPreviousUnlessNewSearch(previous, query, 'naruto')).toBeUndefined();
        expect(keepPreviousUnlessNewSearch(previous, { queryKey: ['anime', 'list', '', '', 'popular', ''] }, '')).toBe(previous);
    });
});
