import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { notify, notifyError } from '../../ui/toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useThreadMutations from '../useThreadMutations';
import { forumsApi } from '../../../api/client';
import { forumKeys } from '../../../api/queries/forums';

vi.mock('../../ui/toast', () => ({
    notify: vi.fn(),
    notifyError: vi.fn(),
}));

// Forum writes report through the shared toast helpers.
const toast = { success: notify, error: notifyError };

vi.mock('../../../api/client', () => ({
    forumsApi: {
        createPost: vi.fn(),
        deleteThread: vi.fn(),
        likePost: vi.fn(),
        subscribeThread: vi.fn(),
        unsubscribeThread: vi.fn(),
        removePost: vi.fn(),
        toggleThreadLock: vi.fn(),
    },
}));

const envelope = (status, detail, code) => ({ response: { status, data: { detail, code } } });

function setup() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useThreadMutations({
        id: '5',
        page: 1,
        queryClient,
        setReplyContent: vi.fn(),
        setShowReplyForm: vi.fn(),
        setReplyTo: vi.fn(),
        setEditingThread: vi.fn(),
        setEditingPostId: vi.fn(),
    }), { wrapper });
    return { result, queryClient };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useThreadMutations', () => {
    it('shows the envelope detail when a reply is refused', async () => {
        forumsApi.createPost.mockRejectedValue(envelope(400, 'This thread is locked.', 'invalid'));
        const { result } = setup();

        await act(async () => {
            result.current.createPostMutation.mutate({ content: 'hi' });
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This thread is locked.'));
    });

    it('shows the 409 detail when an author deletes a thread with replies', async () => {
        forumsApi.deleteThread.mockRejectedValue(envelope(
            409,
            'Threads with replies can only be removed by a moderator.',
            'thread_has_replies',
        ));
        const { result } = setup();

        await act(async () => {
            result.current.deleteThreadMutation.mutate();
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
            'Threads with replies can only be removed by a moderator.',
        ));
    });

    it('falls back to a generic message without a detail, and uses the throttle copy for 429', async () => {
        forumsApi.createPost.mockRejectedValueOnce(new Error('Network Error'));
        forumsApi.createPost.mockRejectedValueOnce(envelope(429, 'Request was throttled.', 'throttled'));
        const { result } = setup();

        await act(async () => {
            result.current.createPostMutation.mutate({ content: 'hi' });
        });
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to post reply'));

        await act(async () => {
            result.current.createPostMutation.mutate({ content: 'hi' });
        });
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
            'You are doing that too fast. Please wait a moment.',
        ));
    });

    it('patches a liked post in every cached payload and rolls back on error', async () => {
        forumsApi.likePost.mockRejectedValue(envelope(500, 'Server error', 'error'));
        const { result, queryClient } = setup();
        const pageData = { count: 1, next: null, results: [{ id: 9, like_count: 1, is_liked_by_user: false }] };
        queryClient.setQueryData(forumKeys.posts('5', 1), pageData);
        queryClient.setQueryData(forumKeys.postSubtree('5', 9), pageData);

        await act(async () => {
            result.current.likePostMutation.mutate(9);
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server error'));
        expect(queryClient.getQueryData(forumKeys.posts('5', 1)).results[0].like_count).toBe(1);
        expect(queryClient.getQueryData(forumKeys.postSubtree('5', 9)).results[0].like_count).toBe(1);
    });

    it('follows a thread optimistically and reverts on failure', async () => {
        let reject;
        forumsApi.subscribeThread.mockImplementation(() => new Promise((_resolve, r) => { reject = r; }));
        const { result, queryClient } = setup();
        queryClient.setQueryData(forumKeys.thread('5'), { id: 5, is_subscribed: false });

        act(() => {
            result.current.toggleSubscriptionMutation.mutate(true);
        });
        await waitFor(() => expect(queryClient.getQueryData(forumKeys.thread('5')).is_subscribed).toBe(true));

        await act(async () => {
            reject(envelope(400, 'Nope.', 'invalid'));
        });
        await waitFor(() => expect(queryClient.getQueryData(forumKeys.thread('5')).is_subscribed).toBe(false));
        expect(toast.error).toHaveBeenCalledWith('Nope.');
    });

    it('marks a post removed by a moderator in the cache', async () => {
        forumsApi.removePost.mockResolvedValue({ status: 'removed', is_removed: true });
        const { result, queryClient } = setup();
        queryClient.setQueryData(forumKeys.posts('5', 1), { count: 1, next: null, results: [{ id: 9, is_removed: false }] });

        await act(async () => {
            result.current.removePostMutation.mutate({ postId: 9, reason: 'spam' });
        });

        await waitFor(() => expect(forumsApi.removePost).toHaveBeenCalledWith(9, 'spam'));
        await waitFor(() => expect(queryClient.getQueryData(forumKeys.posts('5', 1)).results[0]).toMatchObject({
            is_removed: true,
            removal: 'moderator',
        }));
    });

    it('applies the lock state returned by toggle_lock', async () => {
        forumsApi.toggleThreadLock.mockResolvedValue({ status: 'locked', is_locked: true });
        const { result, queryClient } = setup();
        queryClient.setQueryData(forumKeys.thread('5'), { id: 5, is_locked: false });

        await act(async () => {
            result.current.toggleLockMutation.mutate();
        });

        await waitFor(() => expect(queryClient.getQueryData(forumKeys.thread('5')).is_locked).toBe(true));
        expect(toast.success).toHaveBeenCalledWith('Thread locked');
    });
});
