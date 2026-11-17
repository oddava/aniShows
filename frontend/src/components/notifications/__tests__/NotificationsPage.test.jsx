import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import httpClient from '../../../api/httpClient';
import Notifications from '../../../pages/Notifications';

const api = vi.hoisted(() => ({
    getAll: vi.fn(),
    getUnreadCount: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    delete: vi.fn(),
}));
const socket = vi.hoisted(() => ({ onMessage: null }));

vi.mock('../../../api/modules/notifications', () => ({ notificationApi: api }));
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 7 }, isAuthenticated: true, loading: false }),
}));
vi.mock('../../SEO', () => ({ default: () => null }));
vi.mock('../notificationSocket', () => ({
    useNotificationSocket: ({ onMessage }) => {
        socket.onMessage = onMessage;
    },
}));
vi.mock('../../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const page = (results, next = null) => ({ data: { count: results.length, next, previous: null, results } });

const FOLLOW = {
    id: 1,
    notification_type: 'new_follower',
    category: 'follows',
    title: 'New Follower',
    message: 'mika started following you',
    data: { follower_username: 'mika' },
    is_read: false,
    created_at: '2026-11-15T10:00:00Z',
    url: '/u/mika',
    actor: { username: 'mika', avatar: 'https://cdn.test/mika.png' },
};
const GROUPED_EPISODES = {
    id: 2,
    notification_type: 'new_episode',
    category: 'episodes',
    title: 'New Episode',
    message: 'New episodes of Frieren are out, latest is Episode 7',
    data: { anime_title: 'Frieren', anime_slug: 'frieren', episode_number: 7, grouped: true, anime_cover_image_small: 'https://cdn.test/frieren.jpg' },
    is_read: true,
    created_at: '2026-11-14T10:00:00Z',
    url: '/anime/frieren-server',
    actor: null,
};
const REPLY = {
    id: 3,
    notification_type: 'forum_reply',
    category: 'replies',
    title: 'Forum Reply',
    message: 'sora replied to your post in "Best openings"',
    data: { thread_id: 5, thread_title: 'Best openings', replier_username: 'sora' },
    is_read: false,
    created_at: '2026-11-13T10:00:00Z',
    url: '/forums/thread/5',
    actor: { username: 'sora', avatar: null },
};

function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="location">{location.pathname}</div>;
}

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/notifications']}>
                <Routes>
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="*" element={<div>elsewhere</div>} />
                </Routes>
                <LocationDisplay />
            </MemoryRouter>
        </QueryClientProvider>
    );
    return client;
};

let getSpy;

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getAll.mockImplementation((params) => Promise.resolve(page(
        params.category === 'episodes' ? [] : [FOLLOW, GROUPED_EPISODES, REPLY].filter(
            (item) => !params.category || item.category === params.category
        )
    )));
    api.getUnreadCount.mockResolvedValue({ data: { count: 2 } });
    getSpy = vi.spyOn(httpClient, 'get');
});

afterEach(() => {
    getSpy.mockRestore();
});

describe('Notifications page', () => {
    it('has an h1 and chips that report their state', async () => {
        renderPage();

        expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
        await screen.findByText('mika');
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Replies' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('filters on the server, with the category in the query key', async () => {
        const client = renderPage();
        await screen.findByText('mika');

        fireEvent.click(screen.getByRole('button', { name: 'Replies' }));

        expect(screen.getByRole('button', { name: 'Replies' })).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(api.getAll).toHaveBeenLastCalledWith({ page_size: 30, page: 1, category: 'replies' }));
        expect(client.getQueryCache().find({ queryKey: ['notifications', 7, 'feed', 30, 'replies'], exact: true })).toBeTruthy();
        await waitFor(() => expect(screen.queryByText('mika')).not.toBeInTheDocument());
        expect(screen.getByText('sora')).toBeInTheDocument();
    });

    it('shows an honest empty state per category', async () => {
        renderPage();
        await screen.findByText('mika');

        fireEvent.click(screen.getByRole('button', { name: 'Episodes' }));

        expect(await screen.findByText('No episode alerts yet.')).toBeInTheDocument();
        expect(screen.getByText('Add airing shows to Watching to get them.')).toBeInTheDocument();
    });

    it('uses images from the payload and makes no lookups of its own', async () => {
        renderPage();
        await screen.findByText('mika');

        expect(screen.getByAltText('mika profile picture')).toHaveAttribute('src', expect.stringContaining('mika.png'));
        // sora has no avatar: initials instead.
        expect(screen.getByLabelText('sora avatar fallback')).toHaveTextContent('SO');
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('labels grouped episode rows and opens the server url', async () => {
        renderPage();

        expect(await screen.findByText(/latest is Episode 7/)).toBeInTheDocument();
        const row = screen.getByText(/latest is Episode 7/).closest('p');
        expect(row).toHaveTextContent('New episodes of Frieren, latest is Episode 7');

        fireEvent.click(screen.getByRole('button', { name: 'Frieren' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/anime/frieren-server'));
    });

    it('deletes a row', async () => {
        api.delete.mockResolvedValue({ status: 204 });
        renderPage();
        await screen.findByText('mika');

        fireEvent.click(screen.getByRole('button', { name: /Delete notification: mika started following you/ }));

        await waitFor(() => expect(api.delete).toHaveBeenCalledWith(1));
        await waitFor(() => expect(screen.queryByText('mika')).not.toBeInTheDocument());
    });

    it('adds a live notification only to feeds it belongs in', async () => {
        renderPage();
        await screen.findByText('mika');
        fireEvent.click(screen.getByRole('button', { name: 'Replies' }));
        await waitFor(() => expect(screen.queryByText('mika')).not.toBeInTheDocument());

        act(() => {
            socket.onMessage({
                type: 'notification',
                notification: { ...FOLLOW, id: 9, message: 'ren started following you', data: { follower_username: 'ren' }, actor: { username: 'ren', avatar: null } },
                unread_count: 3,
            });
            socket.onMessage({
                type: 'notification',
                notification: { ...REPLY, id: 10, message: 'kai replied to your post in "Best openings"', data: { ...REPLY.data, replier_username: 'kai' }, actor: { username: 'kai', avatar: null } },
                unread_count: 4,
            });
        });

        expect(await screen.findByText('kai')).toBeInTheDocument();
        expect(screen.queryByText('ren')).not.toBeInTheDocument();
    });
});
