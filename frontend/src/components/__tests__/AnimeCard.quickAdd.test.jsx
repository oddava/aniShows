import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import AnimeCard from '../AnimeCard';
import { listApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    listApi: { add: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 7, username: 'kiyo' } }),
}));

const frieren = {
    id: 5,
    slug: 'frieren',
    title: 'Frieren',
    anime_type: 'TV',
    episode_count: 28,
    user_list_status: null,
};

function renderCard(anime = frieren, props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <AnimeCard anime={anime} {...props} />
                <Toaster />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('AnimeCard quick add (T1) with toast and Undo (T6)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('adds from the card, says so, and Undo removes it again', async () => {
        listApi.add.mockResolvedValue({ data: { id: 77, status: 'Plan to Watch', episodes_watched: 0 } });
        listApi.remove.mockResolvedValue({});
        renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Add Frieren to your list' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Planning' }));

        await waitFor(() => expect(listApi.add).toHaveBeenCalledWith({ anime_id: 5, status: 'Plan to Watch' }));
        const toast = await screen.findByRole('status');
        expect(toast).toHaveTextContent('Added to Planning');
        expect(screen.getByRole('button', { name: 'Planning. Change list status for Frieren' })).toBeInTheDocument();

        fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));

        await waitFor(() => expect(listApi.remove).toHaveBeenCalledWith(77));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Frieren to your list' })).toBeInTheDocument());
    });

    it('Completed asks for a score in the same menu: three taps for the whole loop', async () => {
        listApi.add.mockResolvedValue({ data: { id: 78, status: 'Completed', episodes_watched: 28, score: 0 } });
        listApi.update.mockResolvedValue({ data: { id: 78, status: 'Completed', episodes_watched: 28, score: 9 } });
        renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Add Frieren to your list' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Completed' }));
        await waitFor(() => expect(listApi.add).toHaveBeenCalledWith({ anime_id: 5, status: 'Completed' }));

        fireEvent.click(await screen.findByRole('radio', { name: '9 out of 10' }));

        await waitFor(() => expect(listApi.update).toHaveBeenCalledWith(78, { score: 9 }));
        expect(await screen.findByText('Your score')).toBeInTheDocument();
        expect(screen.getByText('9', { selector: 'span' })).toBeInTheDocument();
    });

    it('a failed add rolls back and shows the server reason', async () => {
        listApi.add.mockRejectedValue({ response: { data: { detail: 'Lists are read-only right now.' } } });
        renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Add Frieren to your list' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Watching' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Lists are read-only right now.');
        expect(screen.getByRole('button', { name: 'Add Frieren to your list' })).toBeInTheDocument();
    });

    it('shows your score and a visible stepper on Watching cards (T2, T3)', async () => {
        listApi.update.mockResolvedValue({ data: { id: 9, status: 'Watching', episodes_watched: 15, score: 8 } });
        renderCard(
            { ...frieren, user_list_status: { id: 9, status: 'Watching', episodes_watched: 13, score: 8 } },
            { showProgress: true },
        );

        expect(screen.getByTitle('Your score: 8')).toBeInTheDocument();
        const group = screen.getByRole('group', { name: 'Episodes watched of Frieren' });
        expect(group).toHaveTextContent('13 / 28');

        const more = within(group).getByRole('button', { name: 'One episode more of Frieren' });
        fireEvent.click(more);
        fireEvent.click(more);

        expect(group).toHaveTextContent('15 / 28');
        // Two taps, one write.
        await waitFor(() => expect(listApi.update).toHaveBeenCalledTimes(1));
        expect(listApi.update).toHaveBeenCalledWith(9, { episodes_watched: 15 });
    });
});
