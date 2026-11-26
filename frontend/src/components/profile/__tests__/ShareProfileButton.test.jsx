import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notify = vi.fn();
const notifyError = vi.fn();
vi.mock('../../ui/toast', () => ({ notify: (...a) => notify(...a), notifyError: (...a) => notifyError(...a) }));

const { default: ShareProfileButton, profileShareUrl } = await import('../ShareProfileButton');

describe('ShareProfileButton', () => {
    beforeEach(() => {
        notify.mockClear();
        notifyError.mockClear();
    });

    it('copies the /u/ link and says so', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.assign(navigator, { clipboard: { writeText } });
        render(<ShareProfileButton username="oddava" />);

        // The name starts with the visible text (WCAG 2.5.3).
        fireEvent.click(screen.getByRole('button', { name: /^Share: / }));

        await waitFor(() => expect(notify).toHaveBeenCalledWith('Link copied', { id: 'profile-share' }));
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/u/oddava`);
    });

    it('shows the link when copying fails', async () => {
        Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
        render(<ShareProfileButton username="a b" />);

        fireEvent.click(screen.getByRole('button', { name: /^Share: / }));

        await waitFor(() => expect(notifyError).toHaveBeenCalled());
        expect(notifyError.mock.calls[0][0]).toContain('/u/a%20b');
    });

    it('builds the canonical URL', () => {
        expect(profileShareUrl('Bob', 'https://anishows.com')).toBe('https://anishows.com/u/Bob');
    });
});
