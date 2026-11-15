import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HeroSearch from '../HeroSearch';

const mockGetAll = vi.fn();

vi.mock('../../../api/client', () => ({
    animeApi: {
        getAll: (...args) => mockGetAll(...args),
    },
}));

const RESULTS = [
    { id: 1, slug: 'attack-on-titan', title: 'Attack on Titan', anime_type: 'TV', episode_count: 25 },
    { id: 2, slug: 'one-punch-man', title: 'One-Punch Man', anime_type: 'TV', episode_count: 12 },
];

function renderHeroSearch() {
    return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <MemoryRouter>
                <HeroSearch />
                <a href="/register">Create a free account</a>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

describe('HeroSearch', () => {
    beforeEach(() => {
        mockGetAll.mockReset();
        mockGetAll.mockResolvedValue({ data: { results: RESULTS } });
    });

    it('closes the suggestions when keyboard focus moves past the field', { timeout: 10000 }, async () => {
        const user = userEvent.setup();
        renderHeroSearch();

        await user.type(screen.getByRole('combobox', { name: 'Search anime' }), 'an');
        expect(await screen.findByRole('listbox', {}, { timeout: 5000 })).toBeInTheDocument();

        await user.tab(); // the Search button, still inside the widget
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        await user.tab(); // out to the next link: the list must not cover it
        expect(screen.getByRole('link', { name: 'Create a free account' })).toHaveFocus();
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    });

    it('hides the list as soon as the field is cleared', { timeout: 10000 }, async () => {
        const user = userEvent.setup();
        renderHeroSearch();

        const input = screen.getByRole('combobox', { name: 'Search anime' });
        await user.type(input, 'an');
        expect(await screen.findByRole('listbox', {}, { timeout: 5000 })).toBeInTheDocument();

        await user.clear(input);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});
