import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import TrackingPanel from '../TrackingPanel';
import ListEntryEditModal from '../../ListEntryEditModal';
import { listApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
    listApi: { add: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const frieren = { id: 5, slug: 'frieren', title: 'Frieren', episode_count: 28 };

function renderPanel(entry, props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onListUpdate = vi.fn();
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <TrackingPanel
                    anime={{ ...frieren, user_list_status: entry }}
                    isAuthenticated
                    isFavorite={false}
                    onFavorite={vi.fn()}
                    onListUpdate={onListUpdate}
                    {...props}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { onListUpdate };
}

beforeEach(() => vi.clearAllMocks());

describe('Detail page tracking (T5, V1, M3)', () => {
    it('shows your saved score next to the status, and it is tappable to change', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Completed', episodes_watched: 28, score: 10 } });
        const { onListUpdate } = renderPanel({ id: 3, status: 'Completed', episodes_watched: 28, score: 9 });

        const scoreButton = screen.getByRole('button', { name: /Your score\s*9\s*\/ 10/ });
        expect(screen.getByRole('button', { name: 'Completed. Change list status for Frieren' })).toBeInTheDocument();

        fireEvent.click(scoreButton);
        fireEvent.click(screen.getByRole('radio', { name: '10 out of 10' }));

        await waitFor(() => expect(listApi.update).toHaveBeenCalledWith(3, { score: 10 }));
        await waitFor(() => expect(onListUpdate).toHaveBeenCalledWith(expect.objectContaining({ score: 10 })));
        expect(screen.getByRole('button', { name: /Your score\s*10/ })).toBeInTheDocument();
    });

    it('offers the score row right after Completed', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Completed', episodes_watched: 28, score: 0 } });
        renderPanel({ id: 3, status: 'Watching', episodes_watched: 12, score: 0 });

        fireEvent.click(screen.getByRole('button', { name: 'Watching. Change list status for Frieren' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Completed' }));

        expect(await screen.findAllByRole('radiogroup')).not.toHaveLength(0);
    });

    it('uses a visible stepper for progress, clamped to the episode count', () => {
        renderPanel({ id: 3, status: 'Watching', episodes_watched: 28, score: 0 });
        expect(screen.getByRole('group', { name: 'Episodes watched of Frieren' })).toHaveTextContent('28 / 28');
        expect(screen.getByRole('button', { name: 'One episode more of Frieren' })).toBeDisabled();
    });

    it('asks a signed-out visitor to sign in instead', () => {
        render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <TrackingPanel anime={frieren} isAuthenticated={false} />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        expect(screen.getByRole('link', { name: 'Sign in to track' })).toHaveAttribute('href', '/login');
    });
});

describe('Edit modal (T4, T8)', () => {
    const statusOptions = [{ value: 'Watching', label: 'Watching' }, { value: 'Completed', label: 'Completed' }];

    it('shows inline errors instead of browser tooltips, and never saves past the episode count', async () => {
        const onSave = vi.fn();
        render(
            <ListEntryEditModal
                isOpen
                onClose={vi.fn()}
                onSave={onSave}
                initialEntry={{ id: 1, status: 'Watching', episodes_watched: 3, score: 0 }}
                totalEpisodes={12}
                statusOptions={statusOptions}
                isSaving={false}
                animeTitle="Frieren"
            />,
        );

        fireEvent.change(screen.getByLabelText(/episode progress/i), { target: { value: '99' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(await screen.findByText('This show has 12 episodes.')).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('scores with one tap and reads dates unambiguously', () => {
        const onSave = vi.fn().mockResolvedValue({ id: 1 });
        render(
            <ListEntryEditModal
                isOpen
                onClose={vi.fn()}
                onSave={onSave}
                initialEntry={{ id: 1, status: 'Completed', episodes_watched: 12, score: 0, started_at: '2026-11-20' }}
                totalEpisodes={12}
                statusOptions={statusOptions}
                isSaving={false}
            />,
        );

        expect(screen.getByText('20 Nov 2026')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: '8 out of 10' }));
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ score: 8 }));
    });
});
