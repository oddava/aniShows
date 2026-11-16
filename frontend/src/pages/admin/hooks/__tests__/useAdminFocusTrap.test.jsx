import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import useAdminFocusTrap from '../useAdminFocusTrap';

function Dialog() {
    const ref = useAdminFocusTrap(true, () => {});
    return (
        <div ref={ref} role="dialog" aria-label="Grant badge">
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
});
