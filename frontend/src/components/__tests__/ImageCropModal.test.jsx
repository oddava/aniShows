import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageCropModal from '../ImageCropModal';

// The cropper reports one crop as soon as it mounts, as the real one does.
vi.mock('react-easy-crop', async () => {
    const { useEffect } = await vi.importActual('react');
    return {
        default: function Cropper({ onCropComplete }) {
            useEffect(() => {
                onCropComplete?.({ x: 10, y: 0, width: 80, height: 100 }, { x: 54, y: 0, width: 432, height: 540 });
            }, [onCropComplete]);
            return <div data-testid="cropper" />;
        },
    };
});
vi.mock('../../utils/cropImage', () => ({ default: vi.fn() }));

function Harness({ onClose = () => {} }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open cropper</button>
            <ImageCropModal
                isOpen={open}
                imageSrc="blob:test"
                aspect={1}
                title="Edit profile picture"
                onClose={() => {
                    onClose();
                    setOpen(false);
                }}
                onApply={() => setOpen(false)}
            />
        </>
    );
}

const openModal = () => {
    const opener = screen.getByRole('button', { name: 'Open cropper' });
    opener.focus();
    fireEvent.click(opener);
    return opener;
};

describe('ImageCropModal', () => {
    it('renders nothing while closed', () => {
        render(<Harness />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is a modal dialog labelled by its title', () => {
        render(<Harness />);
        openModal();

        const dialog = screen.getByRole('dialog', { name: 'Edit profile picture' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('moves focus into the dialog', async () => {
        render(<Harness />);
        openModal();

        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    });

    it('closes on Escape and returns focus to the opener', async () => {
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);
        const opener = openModal();
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });

    it('returns focus to the opener when closed with the button', () => {
        render(<Harness />);
        const opener = openModal();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });

    it('hands back the crop box for an animation instead of flattening it', async () => {
        const onApply = vi.fn();
        render(
            <ImageCropModal isOpen imageSrc="blob:gif" aspect={1} keepAnimation onApply={onApply} onClose={() => {}} />,
        );

        expect(screen.getByText(/Stays animated/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(() => expect(onApply).toHaveBeenCalledWith(null, null, {
            pixels: { x: 54, y: 0, width: 432, height: 540 },
            area: { x: 10, y: 0, width: 80, height: 100 },
        }));
    });
});
