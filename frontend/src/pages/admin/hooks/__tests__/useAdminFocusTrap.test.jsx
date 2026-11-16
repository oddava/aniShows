import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import useAdminFocusTrap from '../useAdminFocusTrap';

function Dialog({ label = 'Grant badge', children }) {
    const ref = useAdminFocusTrap(true, () => {});
    return (
        <div ref={ref} role="dialog" aria-label={label}>
            {children}
            <button type="button">Close</button>
            <input aria-label="Search users" />
            <button type="button">Cancel</button>
            <button type="button" disabled>Grant</button>
        </div>
    );
}

describe('useAdminFocusTrap', () => {
    it('wraps Tab past a disabled last button instead of leaving the dialog', async () => {
        render(<><button type="button">Outside</button><Dialog /></>);
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(dialog).toContainElement(document.activeElement), { timeout: 5000 });

        const cancel = screen.getByRole('button', { name: 'Cancel' });
        cancel.focus();
        fireEvent.keyDown(cancel, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

        fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(cancel);
    });

    it('pulls focus back in when it fell outside the dialog', async () => {
        render(<><button type="button">Outside</button><Dialog /></>);
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(dialog).toContainElement(document.activeElement), { timeout: 5000 });

        document.body.focus(); // e.g. a click on a non-focusable part of the dialog
        fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });

    it('lets only the innermost of nested dialogs handle Tab', async () => {
        function Nested() {
            const ref = useAdminFocusTrap(true, () => {});
            return (
                <div ref={ref} role="dialog" aria-label="Confirm">
                    <button type="button">No</button>
                    <button type="button">Yes</button>
                </div>
            );
        }
        // The confirm opens over an already-open drawer.
        const { rerender } = render(<Dialog label="Drawer" />);
        await screen.findByRole('dialog', { name: 'Drawer' }, { timeout: 5000 });
        rerender(<Dialog label="Drawer"><Nested /></Dialog>);
        const yes = await screen.findByRole('button', { name: 'Yes' }, { timeout: 5000 });

        yes.focus();
        fireEvent.keyDown(yes, { key: 'Tab' });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }));
    });
});
