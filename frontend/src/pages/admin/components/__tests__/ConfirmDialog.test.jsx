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
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'Narut' } });
        fireEvent.submit(confirm.closest('form'));
        expect(onConfirm).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'Naruto' } });
        expect(confirm).not.toHaveAttribute('aria-disabled');

        fireEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps Tab inside the dialog while the confirm button is gated', async () => {
        render(<Harness requireText="Naruto" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));

        const dialog = screen.getByRole('alertdialog');
        const input = screen.getByLabelText(/to confirm/);
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        const confirm = screen.getByRole('button', { name: 'Delete' });
        await waitFor(() => expect(dialog).toContainElement(document.activeElement), { timeout: 5000 });

        // The gated confirm stays in the tab order, so the trap's last stop is real.
        expect(confirm).not.toHaveAttribute('disabled');
        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(dialog).toContainElement(document.activeElement);
        expect(document.activeElement).not.toBe(confirm);

        input.focus();
        fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(confirm);

        // Clicking the gated confirm does nothing and keeps the dialog open.
        fireEvent.click(confirm);
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        expect(cancel).toBeInTheDocument();
    });
});
