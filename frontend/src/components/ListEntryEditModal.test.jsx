import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ListEntryEditModal from './ListEntryEditModal';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching' },
    { value: 'Completed', label: 'Completed' },
    { value: 'On Hold', label: 'On Hold' },
    { value: 'Dropped', label: 'Dropped' },
    { value: 'Plan to Watch', label: 'Plan to Watch' },
];

const COMPLETED_ENTRY = {
    id: 1,
    status: 'Completed',
    episodes_watched: 19,
    score: 8,
    started_at: '2024-01-01',
    finished_at: '2024-01-10',
    total_rewatches: 1,
    notes: 'Finished',
};

describe('ListEntryEditModal', () => {
    it('keeps the selected status while open even if parent entry props change', () => {
        const onClose = vi.fn();
        const onSave = vi.fn();

        const view = render(
            <ListEntryEditModal
                isOpen
                onClose={onClose}
                onSave={onSave}
                initialEntry={{
                    id: 1,
                    status: 'Completed',
                    episodes_watched: 12,
                    score: 8,
                    started_at: '2024-01-01',
                    finished_at: '2024-01-10',
                    total_rewatches: 1,
                    notes: 'Original',
                }}
                totalEpisodes={12}
                statusOptions={STATUS_OPTIONS}
                isSaving={false}
            />
        );

        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByLabelText(/status/i));
        fireEvent.click(within(dialog).getByRole('option', { name: 'On Hold' }));
        expect(within(dialog).getByLabelText(/status/i)).toHaveTextContent('On Hold');

        view.rerender(
            <ListEntryEditModal
                isOpen
                onClose={onClose}
                onSave={onSave}
                initialEntry={{
                    id: 1,
                    status: 'Completed',
                    episodes_watched: 12,
                    score: 9,
                    started_at: '2024-01-01',
                    finished_at: '2024-01-10',
                    total_rewatches: 2,
                    notes: 'Parent rerender',
                }}
                totalEpisodes={12}
                statusOptions={STATUS_OPTIONS}
                isSaving={false}
            />
        );

        expect(screen.getByLabelText(/status/i)).toHaveTextContent('On Hold');
    });

    it('keeps typed progress when switching away from completed (the server decides)', async () => {
        const onSave = vi.fn().mockResolvedValue({ id: 1 });

        render(
            <ListEntryEditModal
                isOpen
                onClose={vi.fn()}
                onSave={onSave}
                initialEntry={{ ...COMPLETED_ENTRY }}
                totalEpisodes={19}
                statusOptions={STATUS_OPTIONS}
                isSaving={false}
            />
        );

        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByLabelText(/status/i));
        fireEvent.click(within(dialog).getByRole('option', { name: 'On Hold' }));

        expect(within(dialog).getByLabelText(/episode progress/i)).toHaveValue(19);

        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        expect(onSave).toHaveBeenCalledWith({
            status: 'On Hold',
            score: 8,
            episodes_watched: 19,
            started_at: '2024-01-01',
            finished_at: '2024-01-10',
            total_rewatches: 1,
            is_rewatching: false,
            notes: 'Finished',
        });
    });

    it('sends the rewatch toggle', () => {
        const onSave = vi.fn().mockResolvedValue({ id: 1 });

        render(
            <ListEntryEditModal
                isOpen
                onClose={vi.fn()}
                onSave={onSave}
                initialEntry={{ ...COMPLETED_ENTRY }}
                totalEpisodes={19}
                statusOptions={STATUS_OPTIONS}
                isSaving={false}
            />
        );

        const toggle = screen.getByRole('switch', { name: /rewatching/i });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ is_rewatching: true, total_rewatches: 1 }));
    });

    it('counts notes against the 5,000 character limit', () => {
        render(
            <ListEntryEditModal
                isOpen
                onClose={vi.fn()}
                onSave={vi.fn()}
                initialEntry={{ ...COMPLETED_ENTRY, notes: '' }}
                totalEpisodes={19}
                statusOptions={STATUS_OPTIONS}
                isSaving={false}
            />
        );

        const notes = screen.getByLabelText(/notes/i);
        expect(notes).toHaveAttribute('maxLength', '5000');
        expect(screen.getByText('0 / 5,000')).toBeInTheDocument();

        fireEvent.change(notes, { target: { value: 'Great ending' } });

        expect(screen.getByText('12 / 5,000')).toBeInTheDocument();
    });

    it('names the anime in the title', () => {
        render(
            <ListEntryEditModal
                isOpen
                onClose={vi.fn()}
                onSave={vi.fn()}
                initialEntry={{ ...COMPLETED_ENTRY }}
                totalEpisodes={19}
                statusOptions={STATUS_OPTIONS}
                isSaving={false}
                animeTitle="Frieren: Beyond Journey's End"
            />
        );

        expect(screen.getByRole('dialog')).toHaveAccessibleName(/frieren: beyond journey's end/i);
    });
});
