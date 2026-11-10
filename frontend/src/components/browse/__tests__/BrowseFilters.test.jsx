import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrowseResults from '../BrowseResults';
import useBrowseUrlFilters from '../useBrowseUrlFilters';

vi.mock('../../AnimeCard', () => ({
    default: ({ anime, rank }) => <div data-testid="card">{`${anime.title}${rank ? ` #${rank}` : ''}`}</div>,
}));
vi.mock('../AnimeListRow', () => ({
    default: ({ anime }) => <div data-testid="row">{anime.title}</div>,
}));
vi.mock('../AnimeMinimalCard', () => ({
    default: ({ anime }) => <div data-testid="minimal">{anime.title}</div>,
}));

const ANIME = [
    { id: 1, title: 'Alpha' },
    { id: 2, title: 'Beta' },
];

const resultsProps = (overrides = {}) => ({
    viewMode: 'grid',
    allAnime: ANIME,
    titleLanguage: 'en',
    currentSort: 'popular',
    currentSearch: '',
    hasActiveFilters: true,
    clearAllFilters: vi.fn(),
    isLoading: false,
    isTabSwitching: false,
    isError: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    skeletonCount: 4,
    loadMoreRef: vi.fn(),
    ...overrides,
});

describe('BrowseResults', () => {
    it('renders cards in grid mode and ranks them when sorted by rating', () => {
        render(<BrowseResults {...resultsProps({ currentSort: 'rating' })} />);

        expect(screen.getAllByTestId('card').map((el) => el.textContent)).toEqual(['Alpha #1', 'Beta #2']);
    });

    it('renders rows in list mode and small cards in minimal mode', () => {
        const { rerender } = render(<BrowseResults {...resultsProps({ viewMode: 'list' })} />);
        expect(screen.getAllByTestId('row')).toHaveLength(2);

        rerender(<BrowseResults {...resultsProps({ viewMode: 'minimal' })} />);
        expect(screen.getAllByTestId('minimal')).toHaveLength(2);
    });

    it('offers a retry when loading failed', () => {
        const props = resultsProps({ isError: true });
        render(<BrowseResults {...props} />);

        expect(screen.getByText('Failed to load anime')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(props.refetch).toHaveBeenCalled();
    });

    it('hides the results while loading and attaches the sentinel', () => {
        const props = resultsProps({ isLoading: true });
        render(<BrowseResults {...props} />);

        expect(screen.queryAllByTestId('card')).toHaveLength(0);
        expect(props.loadMoreRef).toHaveBeenCalled();
    });
});

let latestLocation;
function LocationProbe() {
    latestLocation = useLocation();
    return null;
}

const renderFilters = (url) => renderHook(() => useBrowseUrlFilters(), {
    wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[url]}>
            <LocationProbe />
            {children}
        </MemoryRouter>
    ),
});

describe('useBrowseUrlFilters', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reads the filters from the URL and switches to grid mode', () => {
        const { result } = renderFilters('/browse?genre=action,drama&type=TV&min_rating=7');

        expect(result.current.currentGenres).toEqual(['action', 'drama']);
        expect(result.current.currentTypes).toBe('TV');
        expect(result.current.localFilters.minRating).toBe('7');
        expect(result.current.isGridMode).toBe(true);
        expect(result.current.hasActiveFilters).toBe(true);
    });

    it('stays in row mode without filters', () => {
        const { result } = renderFilters('/browse');

        expect(result.current.isGridMode).toBe(false);
        expect(result.current.hasActiveFilters).toBe(false);
    });

    it('toggles a genre in the URL and drops exclude_ids', () => {
        const { result } = renderFilters('/browse?genre=action&exclude_ids=1,2');

        act(() => result.current.toggleLocalGenre('drama'));
        expect(new URLSearchParams(latestLocation.search).get('genre')).toBe('action,drama');
        expect(latestLocation.search).not.toContain('exclude_ids');

        act(() => result.current.toggleLocalGenre('action'));
        expect(new URLSearchParams(latestLocation.search).get('genre')).toBe('drama');
    });

    it('debounces range filters and clears the season when a year range is set', () => {
        vi.useFakeTimers();
        const { result } = renderFilters('/browse?season=winter&year=2024');

        act(() => result.current.updateLocalFilter('minYear', '2010'));
        expect(result.current.localFilters.minYear).toBe('2010');
        expect(new URLSearchParams(latestLocation.search).get('min_year')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(250);
        });
        const params = new URLSearchParams(latestLocation.search);
        expect(params.get('min_year')).toBe('2010');
        expect(params.get('season')).toBeNull();
        expect(params.get('year')).toBeNull();
    });
});
