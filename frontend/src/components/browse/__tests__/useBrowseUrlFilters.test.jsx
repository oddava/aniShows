import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useBrowseUrlFilters, { resolveBrowseSort } from '../useBrowseUrlFilters';
import useBrowseAnimeList from '../useBrowseAnimeList';
import SortSelect from '../SortSelect';
import { getSortOptions } from '../browseFilterOptions';
import { usePrefetchAnime } from '../../../hooks/usePrefetchAnime';
import { animeKeys } from '../../../api/queries/anime';

const mockGetAll = vi.hoisted(() => vi.fn());

vi.mock('../../../api/client', () => ({
    animeApi: { getAll: (...args) => mockGetAll(...args) },
}));

let latestLocation;
function LocationProbe() {
    latestLocation = useLocation();
    return null;
}

const searchOf = () => new URLSearchParams(latestLocation.search);

function makeWrapper(url, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
    return function Wrapper({ children }) {
        return (
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[url]}>
                    <LocationProbe />
                    {children}
                </MemoryRouter>
            </QueryClientProvider>
        );
    };
}

beforeEach(() => {
    mockGetAll.mockReset();
    mockGetAll.mockResolvedValue({ data: { results: [], next: null } });
});

describe('resolveBrowseSort (B1)', () => {
    it.each([
        [null, 'frieren', 'relevance'],
        [null, '', 'popular'],
        ['rating', 'frieren', 'rating'],
        ['rating', '', 'rating'],
        ['relevance', 'frieren', 'relevance'],
        // "relevance" ranks nothing without a search.
        ['relevance', '', 'popular'],
    ])('sort=%s q=%s -> %s', (sort, q, expected) => {
        expect(resolveBrowseSort(sort, q)).toBe(expected);
    });
});

describe('useBrowseUrlFilters sort', () => {
    it('ranks a search by relevance and keeps an explicit sort', () => {
        const search = renderHook(() => useBrowseUrlFilters(), { wrapper: makeWrapper('/browse?q=frieren') });
        expect(search.result.current.currentSort).toBe('relevance');

        const sorted = renderHook(() => useBrowseUrlFilters(), { wrapper: makeWrapper('/browse?q=frieren&sort=rating') });
        expect(sorted.result.current.currentSort).toBe('rating');

        const plain = renderHook(() => useBrowseUrlFilters(), { wrapper: makeWrapper('/browse') });
        expect(plain.result.current.currentSort).toBe('popular');
    });

    it('setSort writes an explicit sort and "Best match" removes it', () => {
        const { result } = renderHook(() => useBrowseUrlFilters(), {
            wrapper: makeWrapper('/browse?q=frieren&exclude_ids=1'),
        });

        act(() => result.current.setSort('rating'));
        expect(searchOf().get('sort')).toBe('rating');
        expect(searchOf().get('q')).toBe('frieren');
        expect(searchOf().has('exclude_ids')).toBe(false);

        act(() => result.current.setSort('relevance'));
        expect(searchOf().has('sort')).toBe(false);
        expect(searchOf().get('q')).toBe('frieren');
        expect(result.current.currentSort).toBe('relevance');
    });
});

describe('getSortOptions', () => {
    it('offers "Best match" only while there is a search', () => {
        expect(getSortOptions(true).map((o) => o.label)).toContain('Best match');
        expect(getSortOptions(false).map((o) => o.label)).not.toContain('Best match');
    });
});

function SortHarness() {
    const filters = useBrowseUrlFilters();
    return (
        <SortSelect
            value={filters.currentSort}
            hasSearch={Boolean(filters.currentSearch)}
            onChange={filters.setSort}
        />
    );
}

describe('SortSelect on Browse', () => {
    it('shows "Best match" for a search, and picking "Highest Rated" keeps sort=rating', () => {
        const Wrapper = makeWrapper('/browse?q=frieren');
        render(<Wrapper><SortHarness /></Wrapper>);

        const trigger = screen.getByRole('button', { name: 'Sort by' });
        expect(trigger).toHaveTextContent('Best match');

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: 'Highest Rated' }));
        expect(searchOf().get('sort')).toBe('rating');
        expect(screen.getByRole('button', { name: 'Sort by' })).toHaveTextContent('Highest Rated');

        fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
        fireEvent.click(screen.getByRole('option', { name: 'Best match' }));
        expect(searchOf().has('sort')).toBe(false);
    });

    it('does not offer "Best match" without a search', () => {
        const Wrapper = makeWrapper('/browse?genre=action');
        render(<Wrapper><SortHarness /></Wrapper>);

        fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
        expect(screen.queryByRole('option', { name: 'Best match' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Most Popular' })).toHaveAttribute('aria-selected', 'true');
    });
});

describe('Browse requests', () => {
    it('sends sort=relevance for a search without an explicit sort', async () => {
        const wrapper = makeWrapper('/browse?q=frieren');
        renderHook(() => {
            const filters = useBrowseUrlFilters();
            return useBrowseAnimeList({ filters, adultContentEnabled: false });
        }, { wrapper });

        await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
        expect(mockGetAll.mock.calls[0][0]).toMatchObject({ q: 'frieren', sort: 'relevance' });
    });

    it('the next-page prefetch builds the same key as the grid', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const prefetch = vi.spyOn(client, 'prefetchInfiniteQuery');
        const { result } = renderHook(() => usePrefetchAnime(), { wrapper: makeWrapper('/browse', client) });

        act(() => result.current.prefetchNextPage({ search: 'frieren', genres: [], tags: [] }, 2));

        const { queryKey } = prefetch.mock.calls[0][0];
        expect(queryKey).toEqual(animeKeys.browseList({
            genres: '', tags: '', sort: 'relevance', search: 'frieren', type: '', status: '',
            studio: '', season: '', year: '', excludeIds: '', shelf: '', minRating: '',
            maxRating: '', source: '', minEpisodes: '', maxEpisodes: '', minDuration: '',
            maxDuration: '', minYear: '', maxYear: '', adultContentEnabled: false,
        }));
        await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
        expect(mockGetAll.mock.calls[0][0]).toMatchObject({ q: 'frieren', sort: 'relevance', page: 2 });
    });
});
