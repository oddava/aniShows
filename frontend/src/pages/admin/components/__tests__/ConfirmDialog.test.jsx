import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ConfirmDialog from '../ConfirmDialog';

function Harness({ requireText, onConfirm = () => {} }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            <ConfirmDialog
                isOpen={open}
                title="Delete genre?"
                message="This cannot be undone."
                destructive
                confirmLabel="Delete"
                requireText={requireText}
                onConfirm={() => { onConfirm(); setOpen(false); }}
                onCancel={() => setOpen(false)}
            />
        </>
    );
}

describe('ConfirmDialog', () => {
    it('is an alertdialog that takes focus, cancels on Escape and returns focus', async () => {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Open' });
        opener.focus();
        fireEvent.click(opener);

        const dialog = screen.getByRole('alertdialog', { name: 'Delete genre?' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
        await waitFor(() => expect(dialog).toContainElement(document.activeElement));

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    it('keeps the confirm button disabled until the text is typed', () => {
        const onConfirm = vi.fn();
        render(<Harness requireText="Naruto" onConfirm={onConfirm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));

        const confirm = screen.getByRole('button', { name: 'Delete' });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'Narut' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'Naruto' } });
        expect(confirm).toBeEnabled();

        fireEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
