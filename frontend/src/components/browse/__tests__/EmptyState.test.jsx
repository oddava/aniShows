import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import EmptyState from '../EmptyState';
import useBrowseUrlFilters from '../useBrowseUrlFilters';

const renderEmpty = (props) => {
    const handlers = { onClearFilters: vi.fn(), onSearchWithoutFilters: vi.fn() };
    render(
        <MemoryRouter>
            <EmptyState {...handlers} hasActiveFilters={false} {...props} />
        </MemoryRouter>,
    );
    return handlers;
};

describe('Browse EmptyState (B23)', () => {
    it('a search with filters offers to search all anime without them', () => {
        const handlers = renderEmpty({ searchQuery: 'frieren', hasActiveFilters: true });

        expect(screen.getByText(/with these filters/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Search all anime for “frieren”' }));
        expect(handlers.onSearchWithoutFilters).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(handlers.onClearFilters).toHaveBeenCalled();
        expect(screen.queryByRole('link', { name: /trending/ })).not.toBeInTheDocument();
    });

    it('a search alone links to what is trending and can be cleared', () => {
        renderEmpty({ searchQuery: 'zzqx' });

        expect(screen.queryByRole('button', { name: /Search all anime/ })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'See what’s trending' })).toHaveAttribute('href', '/browse?sort=trending');
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('filters alone offer only to clear them', () => {
        renderEmpty({ hasActiveFilters: true });

        expect(screen.getByText('No anime match these filters. Try removing one or two.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /trending/ })).not.toBeInTheDocument();
    });
});

let latestLocation;
function LocationProbe() {
    latestLocation = useLocation();
    return null;
}

describe('useBrowseUrlFilters.searchWithoutFilters', () => {
    it('keeps the query and an explicit sort, and drops every filter', () => {
        const { result } = renderHook(() => useBrowseUrlFilters(), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/browse?q=frieren&genre=action&type=TV&season=fall&year=2026&sort=rating&exclude_ids=3']}>
                    <LocationProbe />
                    {children}
                </MemoryRouter>
            ),
        });

        act(() => result.current.searchWithoutFilters());

        expect(Object.fromEntries(new URLSearchParams(latestLocation.search))).toEqual({ q: 'frieren', sort: 'rating' });
        expect(result.current.hasActiveFilters).toBe(false);
        expect(result.current.isGridMode).toBe(true);
    });
});
