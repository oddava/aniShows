import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatusSelector from './StatusSelector';
import { listApi } from '../api/client';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }));

vi.mock('../api/client', () => ({
    listApi: {
        add: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
    },
}));

vi.mock('react-hot-toast', () => ({ default: toastMock }));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
    }),
}));

const WATCHING_ENTRY = {
    id: 99,
    status: 'Watching',
    score: 7,
    episodes_watched: 5,
    started_at: '2024-01-10',
    finished_at: null,
    total_rewatches: 1,
    is_rewatching: false,
    notes: 'First pass.',
};

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

    it('sends only the chosen status and lets the server decide the rest', async () => {
        listApi.add.mockResolvedValue({
            data: { id: 44, status: 'Watching', episodes_watched: 0, started_at: '2026-11-16' },
        });
        const onUpdate = vi.fn();

        renderSelector({ onUpdate });

        fireEvent.click(screen.getByRole('button', { name: /add to list/i }));
        fireEvent.click(screen.getByRole('button', { name: /^watching$/i }));

        await waitFor(() => {
            expect(listApi.add).toHaveBeenCalledWith({ anime_id: 321, status: 'Watching' });
        });
        await waitFor(() => {
            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 44, status: 'Watching' }));
        });
    });

    it('does not zero progress when moving to Plan to Watch', async () => {
        listApi.update.mockResolvedValue({ data: { ...WATCHING_ENTRY, status: 'Plan to Watch' } });

        renderSelector({ initialStatus: WATCHING_ENTRY });

        fireEvent.click(screen.getByRole('button', { name: /list status: watching/i }));
        fireEvent.click(screen.getByRole('button', { name: /^plan to watch$/i }));

        await waitFor(() => {
            expect(listApi.update).toHaveBeenCalledWith(99, { status: 'Plan to Watch' });
        });
    });

    it('toggles aria-expanded and points aria-controls at the menu', () => {
        renderSelector();

        const trigger = screen.getByRole('button', { name: /add to list/i });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const menuId = trigger.getAttribute('aria-controls');
        expect(document.getElementById(menuId)).toBeInTheDocument();

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape and returns focus to the trigger', () => {
        renderSelector({ initialStatus: WATCHING_ENTRY });

        const trigger = screen.getByRole('button', { name: /list status: watching/i });
        fireEvent.click(trigger);
        const option = screen.getByRole('button', { name: /^completed$/i });
        option.focus();

        fireEvent.keyDown(option, { key: 'Escape' });

        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('button', { name: /^completed$/i })).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it('closes when focus leaves the control', () => {
        renderSelector({ initialStatus: WATCHING_ENTRY });

        const trigger = screen.getByRole('button', { name: /list status: watching/i });
        fireEvent.click(trigger);
        const outside = screen.getByRole('button', { name: /increase episodes watched/i });

        fireEvent.blur(trigger, { relatedTarget: outside });

        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('labels the progress controls and sends the new progress', async () => {
        listApi.update.mockResolvedValue({ data: { ...WATCHING_ENTRY, episodes_watched: 6 } });

        renderSelector({ initialStatus: WATCHING_ENTRY });

        const input = screen.getByRole('textbox', { name: /episodes watched/i });
        expect(input).toHaveAttribute('inputmode', 'numeric');
        expect(screen.getByRole('button', { name: /decrease episodes watched/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /increase episodes watched/i }));

        await waitFor(() => {
            expect(listApi.update).toHaveBeenCalledWith(99, { episodes_watched: 6 });
        });
        await waitFor(() => expect(input).toHaveValue('6'));
    });

    it('shows an error toast and rolls back when a save fails', async () => {
        listApi.update.mockRejectedValue({ response: { data: { detail: 'Server says no.' } } });

        renderSelector({ initialStatus: WATCHING_ENTRY });

        fireEvent.click(screen.getByRole('button', { name: /increase episodes watched/i }));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith('Server says no.');
        });
        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: /episodes watched/i })).toHaveValue('5');
        });
    });

    it('offers Rewatch on a completed entry', async () => {
        const completed = { ...WATCHING_ENTRY, status: 'Completed', episodes_watched: 12 };
        listApi.update.mockResolvedValue({
            data: { ...completed, status: 'Watching', episodes_watched: 0, is_rewatching: true },
        });

        renderSelector({ initialStatus: completed });

        fireEvent.click(screen.getByRole('button', { name: /list status: completed/i }));
        fireEvent.click(screen.getByRole('button', { name: /^rewatch$/i }));

        await waitFor(() => {
            expect(listApi.update).toHaveBeenCalledWith(99, { is_rewatching: true });
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

        renderSelector({ animeTitle: 'Frieren' });

        fireEvent.click(screen.getByRole('button', { name: /add to list/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('heading', { name: /frieren/i })).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/status/i)).toHaveTextContent('Plan to Watch');
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
                is_rewatching: false,
                notes: '',
            });
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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

        renderSelector({ initialStatus: WATCHING_ENTRY });

        fireEvent.click(screen.getByRole('button', { name: /watching/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByLabelText(/status/i));
        fireEvent.click(within(dialog).getByRole('option', { name: 'Completed' }));
        expect(within(dialog).getByLabelText(/status/i)).toHaveTextContent('Completed');
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
                is_rewatching: false,
                notes: 'Strong finish.',
            });
        });
    });

    it('keeps the editor open when the save fails', async () => {
        listApi.update.mockRejectedValue({ response: { data: { notes: ['Too long.'] } } });

        renderSelector({ initialStatus: WATCHING_ENTRY });

        fireEvent.click(screen.getByRole('button', { name: /watching/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Too long.'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
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
