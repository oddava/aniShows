import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import FavoritesContent from '../FavoritesTab';

const api = vi.hoisted(() => ({
    characters: vi.fn(),
    staff: vi.fn(),
}));

vi.mock('../../../../api/client', () => ({
    favoriteApi: { getAll: vi.fn() },
    characterFavoriteApi: { getAll: api.characters },
    staffFavoriteApi: { getAll: api.staff },
}));
vi.mock('../../../DraggableFavoritesGrid', () => ({
    default: ({ favorites }) => <ul>{favorites.map((f) => <li key={f.id}>{f.anime.title}</li>)}</ul>,
}));

const page = (results, { count = results.length, next = null } = {}) => ({ data: { count, next, results } });
const person = (kind, id) => ({ id, [kind]: { id: 500 + id, name: `${kind} ${id}`, image: '' } });
const animePages = (titles) => ({ pages: [{ count: titles.length, results: titles.map((title, i) => ({ id: i + 1, anime: { title } })) }] });

function renderTab(favoritesData = animePages([])) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <FavoritesContent
                    favoritesData={favoritesData}
                    favoritesLoading={false}
                    hasNextFavorites={false}
                    fetchNextFavorites={vi.fn()}
                    isOwnProfile={false}
                    targetUsername="kiyo"
                    isPublicView
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    api.characters.mockReset();
    api.staff.mockReset();
    api.staff.mockResolvedValue(page([]));
});

describe('Favorites tab', () => {
    it('switches between anime and characters, one kind at a time, with no counts', async () => {
        api.characters.mockResolvedValue(page([person('character', 1), person('character', 2)], { count: 2 }));
        renderTab(animePages(['Frieren']));

        const animeSwitch = await screen.findByRole('button', { name: 'Characters' });
        expect(screen.getByRole('button', { name: 'Anime' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: 'Voice actors' })).not.toBeInTheDocument();
        expect(screen.getByText('Frieren')).toBeInTheDocument();
        expect(screen.queryByText('character 1')).not.toBeInTheDocument();

        fireEvent.click(animeSwitch);
        expect(screen.getByRole('link', { name: 'character 1' })).toHaveAttribute('href', '/character/501');
        expect(screen.queryByText('Frieren')).not.toBeInTheDocument();
        // The switch names each kind: no heading, so no count beside one.
        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('shows characters even with no anime favourites, and loads more pages', async () => {
        api.characters
            .mockResolvedValueOnce(page([person('character', 1)], { count: 2, next: '/api/v1/character-favorites/?page=2' }))
            .mockResolvedValueOnce(page([person('character', 2)], { count: 2 }));
        renderTab();

        expect(await screen.findByText('character 1')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Characters' })).toBeInTheDocument();
        expect(screen.queryByText(/No favorites yet/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(await screen.findByText('character 2')).toBeInTheDocument();
        expect(api.characters).toHaveBeenLastCalledWith({ username: 'kiyo', page: 2, page_size: 48 });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument());
    });

    it('lists favourite voice actors', async () => {
        api.characters.mockResolvedValue(page([]));
        api.staff.mockResolvedValue(page([person('staff', 3)]));
        renderTab();

        expect(await screen.findByRole('link', { name: 'staff 3' })).toHaveAttribute('href', '/staff/503');
    });

    it('says there are no favourites only when every kind is empty', async () => {
        api.characters.mockResolvedValue(page([]));
        renderTab();

        expect(await screen.findByText('No favorites yet.')).toBeInTheDocument();
    });
});
