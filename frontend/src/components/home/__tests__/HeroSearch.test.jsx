import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HeroSearch from '../HeroSearch';

const mockGetAll = vi.fn();

vi.mock('../../../api/client', () => ({
    animeApi: {
        getAll: (...args) => mockGetAll(...args),
    },
}));

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
}));

const RESULTS = [
    { id: 1, slug: 'attack-on-titan', title: 'Attack on Titan', anime_type: 'TV', episode_count: 25 },
    { id: 2, slug: 'one-punch-man', title: 'One-Punch Man', anime_type: 'TV', episode_count: 12 },
];

let latestLocation;
function LocationProbe() {
    latestLocation = useLocation();
    return null;
}

function renderHeroSearch() {
    return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <MemoryRouter initialEntries={['/']}>
                <LocationProbe />
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

    it('uses the shared server search: no request for one character, one abortable request after', { timeout: 10000 }, async () => {
        const user = userEvent.setup();
        renderHeroSearch();

        const input = screen.getByRole('combobox', { name: 'Search anime' });
        await user.type(input, 'a');
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(mockGetAll).not.toHaveBeenCalled();

        await user.type(input, 'n');
        expect(await screen.findByRole('listbox', {}, { timeout: 5000 })).toBeInTheDocument();
        expect(mockGetAll).toHaveBeenCalledTimes(1);
        expect(mockGetAll).toHaveBeenCalledWith({ q: 'an', page_size: 10 }, expect.any(AbortSignal));
    });

    it('shows a no-matches state that opens Browse with the query', { timeout: 10000 }, async () => {
        mockGetAll.mockResolvedValue({ data: { results: [] } });
        const user = userEvent.setup();
        renderHeroSearch();

        await user.type(screen.getByRole('combobox', { name: 'Search anime' }), 'zzqx');

        expect(await screen.findByText(/No matches for “zzqx”\. Try the English or Japanese title/, {}, { timeout: 5000 }))
            .toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Search all anime' }));
        expect(latestLocation.pathname).toBe('/browse');
        expect(new URLSearchParams(latestLocation.search).get('q')).toBe('zzqx');
    });
});
