import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useBrowseUrlFilters, { resolveBrowseSort } from '../useBrowseUrlFilters';
import useBrowseAnimeList from '../useBrowseAnimeList';
import SortSelect from '../SortSelect';
import ActiveFilterChips from '../ActiveFilterChips';
import {
    formatSeasonLabel,
    getSortOptions,
    MAX_YEAR_BOUND,
    MIN_YEAR_BOUND,
    SEASON_OPTIONS,
    stepSeason,
    TYPE_OPTIONS,
} from '../browseFilterOptions';
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

describe('season stepping (P2-7)', () => {
    it.each([
        ['fall', '2024', 1, { season: 'winter', year: '2025' }],
        ['winter', '2024', -1, { season: 'fall', year: '2023' }],
        ['spring', '2024', 1, { season: 'summer', year: '2024' }],
        ['summer', '2024', -1, { season: 'spring', year: '2024' }],
    ])('%s %s %+d', (season, year, direction, expected) => {
        expect(stepSeason(season, year, direction)).toEqual(expected);
    });

    it('stops at the year bounds and ignores unknown input', () => {
        expect(stepSeason('fall', String(MAX_YEAR_BOUND), 1)).toBeNull();
        expect(stepSeason('winter', String(MIN_YEAR_BOUND), -1)).toBeNull();
        expect(stepSeason('monsoon', '2024', 1)).toBeNull();
        expect(stepSeason('fall', '', 1)).toBeNull();
    });

    it('formats the Browse header label', () => {
        expect(formatSeasonLabel('fall', '2026')).toBe('Fall 2026');
        expect(formatSeasonLabel('fall', '')).toBe('');
        expect(formatSeasonLabel('', '2026')).toBe('');
    });

    it('the hook steps the URL season and rolls the year', () => {
        const { result } = renderHook(() => useBrowseUrlFilters(), {
            wrapper: makeWrapper('/browse?season=fall&year=2024&genre=action&exclude_ids=4'),
        });

        act(() => result.current.stepSeason(1));
        expect(searchOf().get('season')).toBe('winter');
        expect(searchOf().get('year')).toBe('2025');
        expect(searchOf().get('genre')).toBe('action');
        expect(searchOf().has('exclude_ids')).toBe(false);

        act(() => result.current.stepSeason(-1));
        expect(searchOf().get('season')).toBe('fall');
        expect(searchOf().get('year')).toBe('2024');
    });

    it('shows ‹ › beside the season chip only when season and year are set', () => {
        const onStepSeason = vi.fn();
        const props = {
            currentGenres: [],
            currentTags: [],
            typeOptions: TYPE_OPTIONS,
            statusOptions: [],
            seasonOptions: SEASON_OPTIONS,
            sourceOptions: [],
            onClearType: vi.fn(),
            onClearStatus: vi.fn(),
            onClearSeason: vi.fn(),
            onStepSeason,
            onClearYear: vi.fn(),
            onClearMinRating: vi.fn(),
            onClearMaxRating: vi.fn(),
            onClearStudio: vi.fn(),
            onToggleGenre: vi.fn(),
            onToggleTag: vi.fn(),
            onClearSource: vi.fn(),
            onClearMinEpisodes: vi.fn(),
            onClearMaxEpisodes: vi.fn(),
            onClearMinDuration: vi.fn(),
            onClearMaxDuration: vi.fn(),
            onClearYearRange: vi.fn(),
            onClearAll: vi.fn(),
            hasActiveFilters: true,
        };
        const { rerender } = render(<ActiveFilterChips {...props} currentSeason="fall" currentYear="2024" />);

        fireEvent.click(screen.getByRole('button', { name: 'Next season: Winter 2025' }));
        expect(onStepSeason).toHaveBeenCalledWith(1);
        fireEvent.click(screen.getByRole('button', { name: 'Previous season: Summer 2024' }));
        expect(onStepSeason).toHaveBeenCalledWith(-1);

        rerender(<ActiveFilterChips {...props} currentTypes="TV" />);
        expect(screen.queryByRole('button', { name: /season:/ })).not.toBeInTheDocument();
    });
});

describe('TYPE_OPTIONS (B24, P2-1)', () => {
    it('offers every type the backend accepts', () => {
        // Backend VALID_TYPES: tv, movie, ova, ona, special, music (compared lowercased).
        expect(TYPE_OPTIONS.map((o) => o.value.toLowerCase()).sort())
            .toEqual(['movie', 'music', 'ona', 'ova', 'special', 'tv']);
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
    it('shows "Best match" for a search, and picking "Highest rated" keeps sort=rating', () => {
        const Wrapper = makeWrapper('/browse?q=frieren');
        render(<Wrapper><SortHarness /></Wrapper>);

        const trigger = screen.getByRole('button', { name: /^Sort by: / });
        expect(trigger).toHaveTextContent('Best match');

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: 'Highest rated' }));
        expect(searchOf().get('sort')).toBe('rating');
        expect(screen.getByRole('button', { name: /^Sort by: / })).toHaveTextContent('Highest rated');

        fireEvent.click(screen.getByRole('button', { name: /^Sort by: / }));
        fireEvent.click(screen.getByRole('option', { name: 'Best match' }));
        expect(searchOf().has('sort')).toBe(false);
    });

    it('does not offer "Best match" without a search', () => {
        const Wrapper = makeWrapper('/browse?genre=action');
        render(<Wrapper><SortHarness /></Wrapper>);

        fireEvent.click(screen.getByRole('button', { name: /^Sort by: / }));
        expect(screen.queryByRole('option', { name: 'Best match' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Most popular' })).toHaveAttribute('aria-selected', 'true');
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
