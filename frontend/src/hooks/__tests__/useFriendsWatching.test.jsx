import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useFriendsWatching } from '../useFriendsWatching';
import FollowButton from '../../components/FollowButton';

const followApi = vi.hoisted(() => ({ getFriendsWatching: vi.fn(), toggle: vi.fn() }));
const auth = vi.hoisted(() => ({ current: { isAuthenticated: true, user: { id: 1, username: 'me' } } }));

vi.mock('../../api/client', () => ({ followApi }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const friend = (id) => ({ user: { id, username: `friend${id}`, avatar: null }, status: 'Watching', episodes_watched: 3, anime: { id: 5 } });

function makeClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Probe({ id, animeId }) {
    const { friends, total, loading, error } = useFriendsWatching(animeId);
    return (
        <p data-testid={`probe-${id}`}>
            {loading ? 'loading' : error ? 'error' : `${friends.length}/${total}`}
        </p>
    );
}

beforeEach(() => {
    followApi.getFriendsWatching.mockReset();
    followApi.toggle.mockReset();
    auth.current = { isAuthenticated: true, user: { id: 1, username: 'me' } };
});

describe('useFriendsWatching', () => {
    it('makes a single request for two mounts of the same anime', async () => {
        followApi.getFriendsWatching.mockResolvedValue({ data: [friend(2), friend(3)], headers: { 'x-total-count': '9' } });
        const client = makeClient();

        render(
            <QueryClientProvider client={client}>
                <Probe id="a" animeId={5} />
                <Probe id="b" animeId={5} />
            </QueryClientProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('probe-a').textContent).toBe('2/9'));
        expect(screen.getByTestId('probe-b').textContent).toBe('2/9');
        expect(followApi.getFriendsWatching).toHaveBeenCalledTimes(1);
        expect(followApi.getFriendsWatching).toHaveBeenCalledWith(5);
    });

    it('tolerates a bare array payload', async () => {
        followApi.getFriendsWatching.mockResolvedValue({ data: [friend(2)] });
        const wrapper = ({ children }) => <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>;

        const { result } = renderHook(() => useFriendsWatching(5), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.friends).toHaveLength(1);
        expect(result.current.total).toBe(1);
        expect(result.current.error).toBeNull();
    });

    it('reports an error separately from "no friends"', async () => {
        followApi.getFriendsWatching.mockRejectedValue(new Error('offline'));
        const wrapper = ({ children }) => <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>;

        const { result } = renderHook(() => useFriendsWatching(5), { wrapper });

        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.friends).toEqual([]);
        expect(result.current.loading).toBe(false);
    });

    it('never shows one account the cached friends of another, even across an unmount', async () => {
        followApi.getFriendsWatching
            .mockResolvedValueOnce({ data: [friend(2)], headers: { 'x-total-count': '1' } })
            .mockResolvedValueOnce({ data: [], headers: { 'x-total-count': '0' } });
        const client = makeClient();
        const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

        const first = render(<Probe id="a" animeId={5} />, { wrapper });
        await waitFor(() => expect(screen.getByTestId('probe-a')).toHaveTextContent('1/1'));
        first.unmount();

        // Account B signs in while the page is closed, then opens the same anime.
        auth.current = { isAuthenticated: true, user: { id: 2, username: 'other' } };
        render(<Probe id="b" animeId={5} />, { wrapper });

        await waitFor(() => expect(screen.getByTestId('probe-b')).toHaveTextContent('0/0'));
        expect(followApi.getFriendsWatching).toHaveBeenCalledTimes(2);
    });

    it('shows nothing cached to a signed-out viewer after an account was used', async () => {
        followApi.getFriendsWatching.mockResolvedValueOnce({ data: [friend(2)], headers: { 'x-total-count': '1' } });
        const client = makeClient();
        const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const first = render(<Probe id="a" animeId={5} />, { wrapper });
        await waitFor(() => expect(screen.getByTestId('probe-a')).toHaveTextContent('1/1'));
        first.unmount();

        auth.current = { isAuthenticated: false, user: null };
        render(<Probe id="c" animeId={5} />, { wrapper });

        expect(screen.getByTestId('probe-c')).toHaveTextContent('0/0');
        expect(followApi.getFriendsWatching).toHaveBeenCalledTimes(1);
    });

    it('does not fetch for signed-out viewers', () => {
        auth.current = { isAuthenticated: false, user: null };
        const wrapper = ({ children }) => <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>;

        const { result } = renderHook(() => useFriendsWatching(5), { wrapper });

        expect(result.current.loading).toBe(false);
        expect(result.current.friends).toEqual([]);
        expect(followApi.getFriendsWatching).not.toHaveBeenCalled();
    });

    it('refetches after a follow toggle', async () => {
        followApi.getFriendsWatching
            .mockResolvedValueOnce({ data: [friend(2)], headers: { 'x-total-count': '1' } })
            .mockResolvedValueOnce({ data: [friend(2), friend(3)], headers: { 'x-total-count': '2' } });
        followApi.toggle.mockResolvedValue({
            data: { status: 'followed', is_following: true, followers_count: 4, following_count: 8 },
        });
        const client = makeClient();

        render(
            <QueryClientProvider client={client}>
                <Probe id="a" animeId={5} />
                <FollowButton username="friend3" initialIsFollower />
            </QueryClientProvider>,
        );
        await waitFor(() => expect(screen.getByTestId('probe-a').textContent).toBe('1/1'));

        fireEvent.click(screen.getByRole('button', { name: 'Follow back friend3' }));

        await waitFor(() => expect(screen.getByTestId('probe-a').textContent).toBe('2/2'));
        expect(followApi.getFriendsWatching).toHaveBeenCalledTimes(2);
    });
});
