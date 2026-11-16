import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import Modal from '../Modal';

describe('Modal', () => {
    it('renders nothing while closed', () => {
        render(<Modal isOpen={false} onClose={() => {}} title="Edit">body</Modal>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a labelled modal dialog with a named close button', () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="Edit genre"><input aria-label="Name" /></Modal>);

        const dialog = screen.getByRole('dialog', { name: 'Edit genre' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('traps focus inside and closes on Escape', async () => {
        const onClose = vi.fn();
        render(
            <Modal isOpen onClose={onClose} title="Edit">
                <input aria-label="Name" />
                <button type="button">Save</button>
            </Modal>,
        );
        const close = screen.getByRole('button', { name: 'Close' });
        const save = screen.getByRole('button', { name: 'Save' });
        await waitFor(() => expect(document.activeElement).toBe(close));

        save.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(close);

        close.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(save);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
