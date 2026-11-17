import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import FollowersModal from '../FollowersModal';

const followApi = vi.hoisted(() => ({ getFollowers: vi.fn(), getFollowing: vi.fn(), toggle: vi.fn() }));

vi.mock('../../api/client', () => ({ followApi }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 1, username: 'me' } }) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const row = (id) => ({ id, user: { id, username: `user${id}`, avatar: null }, is_following: false, is_follower: true });
const listPage = (count, results) => ({ data: { count, next: null, previous: null, results } });

function Harness({ onClose = () => {} }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open followers</button>
            <FollowersModal
                username="kiyo"
                type="followers"
                followersCount={10}
                followingCount={2}
                isOpen={open}
                onClose={() => { onClose(); setOpen(false); }}
            />
        </>
    );
}

function renderHarness(props) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <Harness {...props} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

async function openModal() {
    const opener = screen.getByRole('button', { name: 'Open followers' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    return { opener, dialog };
}

beforeEach(() => {
    Object.values(followApi).forEach((fn) => fn.mockReset());
    followApi.getFollowers.mockResolvedValue(listPage(10, Array.from({ length: 10 }, (_, i) => row(i + 1))));
    followApi.getFollowing.mockResolvedValue(listPage(2, [row(20), row(21)]));
});

describe('FollowersModal', () => {
    it('traps focus inside the dialog and returns it to the opener on Escape', async () => {
        const onClose = vi.fn();
        renderHarness({ onClose });
        const { opener, dialog } = await openModal();

        await screen.findByRole('searchbox', { name: 'Search followers' });
        const focusables = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        last.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(first);

        first.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);

        fireEvent.keyDown(document, { key: 'Escape' });

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(opener);
    });

    it('returns focus to the opener when closed with the close button', async () => {
        renderHarness();
        const { opener } = await openModal();

        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(document.activeElement).toBe(opener);
    });

    it('searches on the server (2+ characters, debounced) instead of filtering loaded rows', async () => {
        renderHarness();
        await openModal();
        const search = await screen.findByRole('searchbox', { name: 'Search followers' });
        expect(followApi.getFollowers).toHaveBeenCalledWith('kiyo', { page: 1 });

        fireEvent.change(search, { target: { value: 'k' } });
        // One character never reaches the server.
        await new Promise((resolve) => { setTimeout(resolve, 400); });
        expect(followApi.getFollowers).toHaveBeenCalledTimes(1);

        followApi.getFollowers.mockResolvedValueOnce(listPage(0, []));
        fireEvent.change(search, { target: { value: 'kiy' } });

        await waitFor(() => expect(followApi.getFollowers).toHaveBeenCalledWith('kiyo', { page: 1, search: 'kiy' }));
        expect(followApi.getFollowers).toHaveBeenCalledTimes(2);
        expect(await screen.findByText('No users matching "kiy"')).toBeTruthy();
        // The tab count stays the unfiltered total and the search box stays.
        expect(screen.getByRole('tab', { name: /Followers/ })).toHaveTextContent('10');
        expect(screen.getByRole('searchbox', { name: 'Search followers' })).toBeTruthy();
    });
});
