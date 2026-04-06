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
});
