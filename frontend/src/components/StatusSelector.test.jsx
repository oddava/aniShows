import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatusSelector from './StatusSelector';
import { listApi } from '../api/client';

vi.mock('../api/client', () => ({
    listApi: {
        add: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
    },
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
    }),
}));

function renderSelector(props = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <StatusSelector animeId={321} totalEpisodes={12} {...props} />
        </QueryClientProvider>
    );
}

describe('StatusSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps quick status changes working from the dropdown', async () => {
        listApi.add.mockResolvedValue({
            data: {
                id: 44,
                status: 'Watching',
                score: 0,
                episodes_watched: 0,
                started_at: null,
                finished_at: null,
                total_rewatches: 0,
                notes: '',
            },
        });

        renderSelector();

        fireEvent.click(screen.getByRole('button', { name: /add to list/i }));
        fireEvent.click(screen.getByRole('button', { name: /^watching$/i }));

        await waitFor(() => {
            expect(listApi.add).toHaveBeenCalledWith({
                anime_id: 321,
                status: 'Watching',
                episodes_watched: 0,
            });
        });
    });

    it('opens the editor with plan-to-watch defaults when no entry exists', async () => {
        listApi.add.mockResolvedValue({
            data: {
                id: 55,
                status: 'Plan to Watch',
                score: 0,
                episodes_watched: 0,
                started_at: null,
                finished_at: null,
                total_rewatches: 0,
                notes: '',
            },
        });

        renderSelector();

        fireEvent.click(screen.getByRole('button', { name: /add to list/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByLabelText(/status/i)).toHaveValue('Plan to Watch');
        expect(within(dialog).getByLabelText(/score/i)).toHaveValue(null);
        expect(within(dialog).getByLabelText(/episode progress/i)).toHaveValue(null);
        expect(within(dialog).getByLabelText(/total rewatches/i)).toHaveValue(null);
        expect(within(dialog).getByLabelText(/notes/i)).toHaveValue('');

        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() => {
            expect(listApi.add).toHaveBeenCalledWith({
                anime_id: 321,
                status: 'Plan to Watch',
                score: 0,
                episodes_watched: 0,
                started_at: null,
                finished_at: null,
                total_rewatches: 0,
                notes: '',
            });
        });
    });

    it('saves detailed edits through the existing list endpoint', async () => {
        listApi.update.mockResolvedValue({
            data: {
                id: 99,
                status: 'Completed',
                score: 9,
                episodes_watched: 12,
                started_at: '2024-01-10',
                finished_at: '2024-02-20',
                total_rewatches: 2,
                notes: 'Strong finish.',
            },
        });

        renderSelector({
            initialStatus: {
                id: 99,
                status: 'Watching',
                score: 7,
                episodes_watched: 5,
                started_at: '2024-01-10',
                finished_at: null,
                total_rewatches: 1,
                notes: 'First pass.',
            },
        });

        fireEvent.click(screen.getByRole('button', { name: /watching/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/status/i), {
            target: { value: 'Completed' },
        });
        fireEvent.change(within(dialog).getByLabelText(/score/i), {
            target: { value: '9' },
        });
        fireEvent.change(within(dialog).getByLabelText(/episode progress/i), {
            target: { value: '12' },
        });
        fireEvent.change(within(dialog).getByLabelText(/finish date/i), {
            target: { value: '2024-02-20' },
        });
        fireEvent.change(within(dialog).getByLabelText(/total rewatches/i), {
            target: { value: '2' },
        });
        fireEvent.change(within(dialog).getByLabelText(/notes/i), {
            target: { value: 'Strong finish.' },
        });

        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() => {
            expect(listApi.update).toHaveBeenCalledWith(99, {
                status: 'Completed',
                score: 9,
                episodes_watched: 12,
                started_at: '2024-01-10',
                finished_at: '2024-02-20',
                total_rewatches: 2,
                notes: 'Strong finish.',
            });
        });
    });

    it('does not steal focus from notes while typing in the editor', async () => {
        renderSelector();

        fireEvent.click(screen.getByRole('button', { name: /add to list/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

        const dialog = await screen.findByRole('dialog');
        const notesInput = within(dialog).getByLabelText(/notes/i);
        notesInput.focus();

        fireEvent.change(notesInput, {
            target: { value: 'episode 1 notes' },
        });

        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(notesInput).toHaveFocus();
        expect(notesInput).toHaveValue('episode 1 notes');
    });
});
