import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ForumThreadDetail from '../ForumThreadDetail';
import { forumsApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
    forumsApi: {
        getThread: vi.fn(),
        getPosts: vi.fn(),
        getPostSubtree: vi.fn(),
        subscribeThread: vi.fn(),
        unsubscribeThread: vi.fn(),
    },
}));

let mockUser = null;
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, isAuthenticated: !!mockUser }),
}));

vi.mock('../../../hooks/useForumWebSocket', () => ({
    useForumWebSocket: vi.fn(),
}));

vi.mock('../../../app/routes/community', () => ({
    preloadForumChunks: vi.fn(),
}));

vi.mock('react-helmet-async', () => ({
    Helmet: () => null,
}));

vi.mock('../../../components/common/MiniProfileHoverCard', () => ({
    default: ({ children }) => children,
}));

vi.mock('../../../components/common/MarkdownRenderer', () => ({
    default: ({ content }) => <div>{content}</div>,
}));

const THREAD = {
    id: 5,
    title: 'Best openings',
    content: 'Discuss.',
    author: { id: 1, username: 'op', avatar: null },
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    like_count: 0,
    is_liked_by_user: false,
    is_locked: false,
    is_pinned: false,
    is_removed: false,
    is_subscribed: false,
    tags: [],
};

const POSTS = {
    count: 1,
    next: null,
    previous: null,
    results: [{
        id: 11,
        parent: null,
        depth: 0,
        content: 'First reply',
        author: { id: 2, username: 'kiyo', avatar: null },
        created_at: '2026-01-01T01:00:00Z',
        like_count: 0,
        reply_count: 0,
        can_reply: true,
    }],
};

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: { detail: 'Error', code: 'error' } },
});

function renderPage(path = '/forums/thread/5') {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/forums/thread/:id" element={<ForumThreadDetail />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    forumsApi.getPosts.mockResolvedValue(POSTS);
});

describe('ForumThreadDetail', () => {
    it('shows "Thread not found" for a 404', async () => {
        forumsApi.getThread.mockRejectedValue(httpError(404));
        renderPage();

        expect(await screen.findByText('Thread not found')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('shows an error state with retry for a 500, and recovers on retry', async () => {
        forumsApi.getThread.mockRejectedValueOnce(httpError(500)).mockResolvedValue(THREAD);
        renderPage();

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.queryByText('Thread not found')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('heading', { name: 'Best openings' })).toBeInTheDocument();
        expect(await screen.findByText('First reply')).toBeInTheDocument();
    });

    it('loads only the focused subtree in "Continue this thread" mode', async () => {
        forumsApi.getThread.mockResolvedValue(THREAD);
        forumsApi.getPostSubtree.mockResolvedValue({
            count: 1,
            next: null,
            previous: null,
            results: [{ ...POSTS.results[0], id: 77, parent: 70, depth: 10, can_reply: false, content: 'Deep reply' }],
        });
        renderPage('/forums/thread/5?post=77');

        expect(await screen.findByText('Deep reply')).toBeInTheDocument();
        expect(forumsApi.getPostSubtree).toHaveBeenCalledWith('5', 77);
        expect(forumsApi.getPosts).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /^Reply$/ })).not.toBeInTheDocument();
    });

    it('replaces the reply box with a locked note for non-staff', async () => {
        mockUser = { username: 'viewer', is_staff: false };
        forumsApi.getThread.mockResolvedValue({ ...THREAD, is_locked: true });
        renderPage();

        expect(await screen.findByText('This thread is locked.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Write a Reply/ })).not.toBeInTheDocument();
    });

    it('shows the follow toggle to signed-in users with aria-pressed', async () => {
        mockUser = { username: 'viewer', is_staff: false };
        forumsApi.getThread.mockResolvedValue(THREAD);
        forumsApi.subscribeThread.mockResolvedValue({ is_subscribed: true });
        renderPage();

        const follow = await screen.findByRole('button', { name: 'Follow thread' });
        expect(follow).toHaveAttribute('aria-pressed', 'false');
        await userEvent.click(follow);

        const unfollow = await screen.findByRole('button', { name: 'Unfollow thread' });
        expect(unfollow).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(forumsApi.subscribeThread).toHaveBeenCalledWith('5'));
    });

    it('does not show the follow toggle to guests', async () => {
        forumsApi.getThread.mockResolvedValue(THREAD);
        renderPage();

        await screen.findByRole('heading', { name: 'Best openings' });
        expect(screen.queryByRole('button', { name: /Follow thread/ })).not.toBeInTheDocument();
    });
});
