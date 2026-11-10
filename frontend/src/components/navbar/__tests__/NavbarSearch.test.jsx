import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NavbarSearch from '../NavbarSearch';
import useNavbarSearch from '../useNavbarSearch';

const mockGetAll = vi.fn();

vi.mock('../../../api/client', () => ({
    animeApi: {
        getAll: (...args) => mockGetAll(...args),
    },
}));

vi.mock('../../../utils/logger', () => ({
    default: { error: vi.fn() },
    isRequestAbortError: vi.fn(() => false),
}));

const SUGGESTIONS = [
    { id: 1, slug: 'frieren', title: 'Frieren: Beyond Journey\'s End', anime_type: 'TV', episode_count: 28, rating: '9.1', isExactMatch: true },
    { id: 2, slug: 'fire-force', title: 'Fire Force', anime_type: 'TV' },
];

const searchState = (overrides = {}) => ({
    searchRef: createRef(),
    searchInputRef: createRef(),
    isSearchExpanded: true,
    setIsSearchExpanded: vi.fn(),
    searchQuery: 'fri',
    setSearchQuery: vi.fn(),
    searchSuggestions: [],
    isSearching: false,
    showSuggestions: true,
    setShowSuggestions: vi.fn(),
    selectedIndex: -1,
    setSelectedIndex: vi.fn(),
    handleSuggestionClick: vi.fn(),
    handleSearch: vi.fn((e) => e?.preventDefault?.()),
    ...overrides,
});

describe('NavbarSearch', () => {
    it('shows the spinner while the first search is in flight', () => {
        render(<NavbarSearch search={searchState({ isSearching: true })} />);

        expect(screen.getByText('Searching...')).toBeInTheDocument();
    });

    it('shows the empty state for a two-letter query with no results', () => {
        render(<NavbarSearch search={searchState({ searchQuery: 'zz' })} />);

        expect(screen.getByText('No results found')).toBeInTheDocument();
    });

    it('renders the lazily loaded suggestion rows and wires their handlers', async () => {
        const state = searchState({ searchSuggestions: SUGGESTIONS, selectedIndex: 0 });
        render(<NavbarSearch search={state} />);

        const first = await screen.findByRole('button', { name: /Beyond Journey/ });
        expect(first).toHaveClass('bg-accent/10');
        expect(screen.getByText('Exact')).toBeInTheDocument();
        expect(screen.getByText('28 eps')).toBeInTheDocument();
        // The matching part of the title is highlighted.
        expect(screen.getAllByText('Fri', { selector: 'span.text-accent' })).toHaveLength(1);

        fireEvent.mouseEnter(screen.getByRole('button', { name: /Fire Force/ }));
        expect(state.setSelectedIndex).toHaveBeenCalledWith(1);

        fireEvent.click(first);
        expect(state.handleSuggestionClick).toHaveBeenCalledWith('frieren');

        fireEvent.click(screen.getByRole('button', { name: 'View all results for "fri"' }));
        expect(state.handleSearch).toHaveBeenCalled();
    });

    it('clears the query from the clear button', () => {
        const state = searchState();
        render(<NavbarSearch search={state} />);

        fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));

        expect(state.setSearchQuery).toHaveBeenCalledWith('');
        expect(state.setShowSuggestions).toHaveBeenCalledWith(false);
        expect(state.setSelectedIndex).toHaveBeenCalledWith(-1);
    });
});

function SearchHarness() {
    const search = useNavbarSearch({ setIsProfileOpen: vi.fn() });
    return <NavbarSearch search={search} />;
}

describe('NavbarSearch with useNavbarSearch', () => {
    beforeEach(() => {
        mockGetAll.mockReset();
        mockGetAll.mockImplementation((params) => {
            if (params.q) {
                return Promise.resolve({ data: { results: [SUGGESTIONS[0]] } });
            }
            return Promise.resolve({ data: { results: [] } });
        });
    });

    it('searches the API after typing and shows the results', async () => {
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter>
                    <SearchHarness />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Toggle Search' }));
        fireEvent.change(screen.getByPlaceholderText('Search anime...'), { target: { value: 'frieren' } });

        expect(await screen.findByRole('button', { name: /Beyond Journey/ }, { timeout: 2000 })).toBeInTheDocument();
        await waitFor(() => {
            expect(mockGetAll).toHaveBeenCalledWith({ q: 'frieren', page_size: 10 });
        });
        expect(screen.getByRole('button', { name: 'View all results for "frieren"' })).toBeInTheDocument();
    });
});
