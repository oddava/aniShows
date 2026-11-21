import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AnimeCard from '../AnimeCard';
import { listApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    listApi: {
        add: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
    },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 7, username: 'kiyo' } }),
}));


const WATCHING_SHELF = JSON.stringify(['user', 'list', 'watching']);

const anime = {
    id: 1,
    slug: 'overgeared',
    title: 'Overgeared',
    anime_type: 'TV',
    episode_count: 12,
    user_list_status: { id: 41, status: 'Watching', episodes_watched: 0 },
};

function renderCard(props = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <AnimeCard anime={anime} {...props} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    const invalidatedKeys = () => invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    return { invalidatedKeys };
}

describe('AnimeCard list-status changes refresh Home\'s Currently Watching shelf', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listApi.update.mockResolvedValue({ data: { id: 41 } });
        listApi.remove.mockResolvedValue({ data: {} });
        listApi.add.mockResolvedValue({ data: { id: 42 } });
    });

    it('invalidates the shelf when the status changes', async () => {
        const { invalidatedKeys } = renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Watching. Change list status for Overgeared' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Completed/ }));

        await waitFor(() => expect(listApi.update).toHaveBeenCalledWith(41, { status: 'Completed' }));
        await waitFor(() => {
            expect(invalidatedKeys()).toContain(WATCHING_SHELF);
            expect(invalidatedKeys()).toContain(JSON.stringify(['lists']));
        });
    });

    it('invalidates the shelf when the entry is removed', async () => {
        const { invalidatedKeys } = renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Watching. Change list status for Overgeared' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }));

        await waitFor(() => expect(listApi.remove).toHaveBeenCalledWith(41));
        await waitFor(() => expect(invalidatedKeys()).toContain(WATCHING_SHELF));
        expect(screen.getByRole('button', { name: 'Add Overgeared to your list' })).toBeInTheDocument();
    });

    it('invalidates the shelf when an episode is marked watched', async () => {
        const { invalidatedKeys } = renderCard({ showProgress: true });

        fireEvent.click(screen.getByRole('button', { name: 'One episode more of Overgeared' }));

        await waitFor(() => expect(listApi.update).toHaveBeenCalledWith(41, { episodes_watched: 1 }));
        await waitFor(() => expect(invalidatedKeys()).toContain(WATCHING_SHELF));
    });
});
