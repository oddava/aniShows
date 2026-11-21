import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BottomSheet from '../BottomSheet';

function Harness({ onClose }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            <a href="/behind">Behind the sheet</a>
            <BottomSheet
                open={open}
                title="Add to your list"
                onClose={() => { onClose(); setOpen(false); }}
            >
                <button type="button">Watching</button>
                <button type="button">Planning</button>
            </BottomSheet>
        </>
    );
}

describe('BottomSheet', () => {
    it('traps focus and closes on Escape when opened after mount', async () => {
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open' })); });
        const dialog = await screen.findByRole('dialog', { name: 'Add to your list' });

        // Focus moves into the sheet, and Shift+Tab from the first item stays inside.
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
        expect(dialog.contains(document.activeElement)).toBe(true);

        fireEvent.keyDown(document.activeElement, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
