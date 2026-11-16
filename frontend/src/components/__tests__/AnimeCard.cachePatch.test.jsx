import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AnimeCard from '../AnimeCard';
import { listApi } from '../../api/client';
import { animeKeys, scheduleKeys } from '../../api/queries/anime';

vi.mock('../../api/client', () => ({
    listApi: { add: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 7, username: 'kiyo' } }),
}));

vi.mock('../../hooks/useAnimeAccentColor', () => ({
    default: () => null,
}));

const anime = {
    id: 1,
    slug: 'overgeared',
    title: 'Overgeared',
    anime_type: 'TV',
    episode_count: 12,
    user_list_status: null,
};

const GRID_KEY = animeKeys.browseList({ sort: 'popular' });
const SCHEDULE_KEY = scheduleKeys.week(true, false);

function renderCard() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(GRID_KEY, { pages: [{ results: [anime], next: null }], pageParams: [1] });
    client.setQueryData(SCHEDULE_KEY, { monday: [anime] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <AnimeCard anime={anime} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    const invalidatedKeys = () => invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    return { client, invalidatedKeys };
}

describe('AnimeCard patches cached anime instead of refetching them (B20)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listApi.add.mockResolvedValue({ data: { id: 42 } });
        listApi.remove.mockResolvedValue({ data: {} });
    });

    it('adding to the list updates the grid and Schedule in place', async () => {
        const { client, invalidatedKeys } = renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Add Overgeared to list' }));
        fireEvent.click(screen.getByRole('button', { name: /Watching/ }));

        await waitFor(() => expect(listApi.add).toHaveBeenCalledWith({ anime_id: 1, status: 'Watching' }));
        await waitFor(() => {
            const card = client.getQueryData(GRID_KEY).pages[0].results[0];
            expect(card.user_list_status).toMatchObject({ id: 42, status: 'Watching', episodes_watched: 0 });
        });
        expect(client.getQueryData(SCHEDULE_KEY).monday[0].user_list_status).toMatchObject({ id: 42, status: 'Watching' });

        const keys = invalidatedKeys();
        expect(keys).not.toContain(JSON.stringify(['anime']));
        expect(keys).not.toContain(JSON.stringify(['seasonal']));
        expect(keys).toContain(JSON.stringify(['lists']));
    });
});
