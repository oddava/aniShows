import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import FollowButton from '../FollowButton';

const followApi = vi.hoisted(() => ({ toggle: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../api/client', () => ({ followApi }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 1, username: 'me' } }) }));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: toast }));

function setup(props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['profile', 'kiyo'], { username: 'kiyo', followers_count: 10, is_following: false });
    client.setQueryData(['ownProfile'], { username: 'me', following_count: 3 });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <FollowButton username="kiyo" {...props} />
        </QueryClientProvider>,
    );
    return { client, invalidate };
}

beforeEach(() => {
    followApi.toggle.mockReset();
    toast.error.mockReset();
});

describe('FollowButton', () => {
    it('has an accessible name and aria-pressed even when icon-only on phones', () => {
        setup({ initialIsFollowing: true });
        const button = screen.getByRole('button', { name: 'Following kiyo' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('writes the server counts into the profile caches and invalidates friends watching', async () => {
        followApi.toggle.mockResolvedValue({
            data: { status: 'followed', is_following: true, followers_count: 42, following_count: 7 },
        });
        const { client, invalidate } = setup();

        const button = screen.getByRole('button', { name: 'Follow kiyo' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(button);

        await waitFor(() => expect(client.getQueryData(['profile', 'kiyo']).followers_count).toBe(42));
        expect(client.getQueryData(['ownProfile']).following_count).toBe(7);
        const keys = invalidate.mock.calls.map(([arg]) => arg.queryKey);
        expect(keys).toContainEqual(['friendsWatching']);
        expect(keys).toContainEqual(['follows']);
        expect(screen.getByRole('button', { name: 'Following kiyo' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('rolls back and shows the envelope detail on failure', async () => {
        followApi.toggle.mockRejectedValue({ response: { status: 400, data: { detail: 'You cannot follow yourself.', code: 'invalid' } } });
        const { client } = setup();

        fireEvent.click(screen.getByRole('button', { name: 'Follow kiyo' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You cannot follow yourself.'));
        expect(client.getQueryData(['profile', 'kiyo']).followers_count).toBe(10);
        expect(screen.getByRole('button', { name: 'Follow kiyo' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the throttle copy on 429', async () => {
        followApi.toggle.mockRejectedValue({ response: { status: 429, data: { detail: 'Request was throttled.', code: 'throttled' } } });
        setup();

        fireEvent.click(screen.getByRole('button', { name: 'Follow kiyo' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You are doing that too fast. Please wait a moment.'));
    });
});
