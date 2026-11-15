import { createRef } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // Warm the lazily loaded rows so a slow first transform cannot time out.
    beforeAll(async () => {
        await import('../SearchSuggestionList');
    });

    it('shows the spinner while the first search is in flight', () => {
        render(<NavbarSearch search={searchState({ isSearching: true })} />);

        expect(screen.getByText('Searching...')).toBeInTheDocument();
    });

    it('shows the empty state for a two-letter query with no results', () => {
        render(<NavbarSearch search={searchState({ searchQuery: 'zz' })} />);

        expect(screen.getByText('No results found')).toBeInTheDocument();
    });

    it('renders the lazily loaded suggestion rows and wires their handlers', { timeout: 10000 }, async () => {
        const state = searchState({ searchSuggestions: SUGGESTIONS, selectedIndex: 0 });
        render(<NavbarSearch search={state} />);

        const first = await screen.findByRole('option', { name: /Beyond Journey/ }, { timeout: 5000 });
        expect(first).toHaveClass('bg-accent/10');
        expect(screen.getByText('Exact')).toBeInTheDocument();
        expect(screen.getByText('28 eps')).toBeInTheDocument();
        // The matching part of the title is highlighted.
        expect(screen.getAllByText('Fri', { selector: 'span.text-accent' })).toHaveLength(1);

        // Hover only highlights (CSS); the arrow-key selection is untouched.
        fireEvent.mouseEnter(screen.getByRole('option', { name: /Fire Force/ }));
        expect(state.setSelectedIndex).not.toHaveBeenCalled();

        fireEvent.click(first);
        expect(state.handleSuggestionClick).toHaveBeenCalledWith('frieren');

        fireEvent.click(screen.getByRole('button', { name: 'View all results for "fri"' }));
        expect(state.handleSearch).toHaveBeenCalled();
    });

    it('clears the query from the clear button', () => {
        const state = searchState();
        render(<NavbarSearch search={state} />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(state.setSearchQuery).toHaveBeenCalledWith('');
        expect(state.setShowSuggestions).toHaveBeenCalledWith(false);
        expect(state.setSelectedIndex).toHaveBeenCalledWith(-1);
    });
});

describe('SearchSuggestionList keyboard selection', () => {
    it('scrolls the arrow-key selection into view inside the dropdown', { timeout: 10000 }, async () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        const state = searchState({ searchSuggestions: SUGGESTIONS, selectedIndex: 1 });
        render(<NavbarSearch search={state} />);

        const second = await screen.findByRole('option', { name: /Fire Force/ }, { timeout: 5000 });
        await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(second);
        delete Element.prototype.scrollIntoView;
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

    it('searches the API after typing and shows the results', { timeout: 10000 }, async () => {
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter>
                    <SearchHarness />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Search anime' }));
        fireEvent.change(screen.getByPlaceholderText('Search anime...'), { target: { value: 'frieren' } });

        expect(await screen.findByRole('option', { name: /Beyond Journey/ }, { timeout: 5000 })).toBeInTheDocument();
        await waitFor(() => {
            expect(mockGetAll).toHaveBeenCalledWith({ q: 'frieren', page_size: 10 });
        });
        expect(screen.getByRole('button', { name: 'View all results for "frieren"' })).toBeInTheDocument();
    });

    it('stops handling suggestion keys once focus leaves the search', { timeout: 10000 }, async () => {
        const user = userEvent.setup();
        const onNextLink = vi.fn((event) => event.preventDefault());
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter>
                    <SearchHarness />
                    <a href="/login" onClick={onNextLink}>Sign In</a>
                </MemoryRouter>
            </QueryClientProvider>
        );

        await user.click(screen.getByRole('button', { name: 'Search anime' }));
        await user.type(screen.getByPlaceholderText('Search anime...'), 'frieren');
        expect(await screen.findByRole('option', { name: /Beyond Journey/ }, { timeout: 5000 })).toBeInTheDocument();
        await user.keyboard('{ArrowDown}');

        // Tab past the search (Clear button, then out) to the next link.
        await user.tab();
        await user.tab();
        expect(screen.getByRole('link', { name: 'Sign In' })).toHaveFocus();
        expect(screen.getByPlaceholderText('Search anime...')).toHaveAttribute('aria-expanded', 'false');

        await user.keyboard('{ArrowDown}{Enter}');
        expect(onNextLink).toHaveBeenCalled();
    });

    it('drops a late response when the search was cleared while it was in flight', { timeout: 10000 }, async () => {
        let resolveSearch;
        mockGetAll.mockImplementation((params) => {
            if (params.q) {
                return new Promise((resolve) => { resolveSearch = resolve; });
            }
            return Promise.resolve({ data: { results: [] } });
        });

        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter>
                    <SearchHarness />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Search anime' }));
        const input = screen.getByPlaceholderText('Search anime...');
        fireEvent.change(input, { target: { value: 'frieren' } });
        await waitFor(() => expect(mockGetAll).toHaveBeenCalledWith({ q: 'frieren', page_size: 10 }));

        // Clear while the request is still pending, then let it land.
        fireEvent.change(input, { target: { value: '' } });
        resolveSearch({ data: { results: [SUGGESTIONS[0]] } });

        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(screen.queryByRole('option', { name: /Beyond Journey/ })).not.toBeInTheDocument();
        expect(input).toHaveAttribute('aria-expanded', 'false');
    });
});
