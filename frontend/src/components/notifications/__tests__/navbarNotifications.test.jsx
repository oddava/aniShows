import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useNavbarNotifications from '../../navbar/useNavbarNotifications';

const api = vi.hoisted(() => ({
    getUnreadCount: vi.fn(),
    markAsRead: vi.fn(),
}));
const pushClient = vi.hoisted(() => ({ syncOnLoad: vi.fn() }));
const socket = vi.hoisted(() => ({ options: null }));

vi.mock('../../../api/modules/notifications', () => ({ notificationApi: api }));
vi.mock('../pushClient', () => pushClient);
vi.mock('../notificationSocket', () => ({
    useNotificationSocket: (options) => {
        socket.options = options;
    },
}));
vi.mock('../../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const listeners = new Set();
const container = {
    addEventListener: (_type, handler) => listeners.add(handler),
    removeEventListener: (_type, handler) => listeners.delete(handler),
};
const postFromWorker = (data) => listeners.forEach((handler) => handler({ data }));

const renderNavbarHook = (entry, user = { id: 7 }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => (
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
        </QueryClientProvider>
    );
    const result = renderHook(() => {
        const count = useNavbarNotifications({ user, isAuthenticated: Boolean(user) });
        const location = useLocation();
        return { count, location };
    }, { wrapper });
    return { ...result, client };
};

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    pushClient.syncOnLoad.mockReset();
    api.getUnreadCount.mockResolvedValue({ data: { count: 3 } });
    listeners.clear();
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
});

afterEach(() => {
    delete navigator.serviceWorker;
});

describe('useNavbarNotifications', () => {
    it('shows the server count, also on /notifications', async () => {
        const { result } = renderNavbarHook('/notifications');
        await waitFor(() => expect(result.current.count).toBe(3));
    });

    it('syncs push once per signed-in user', async () => {
        const { rerender } = renderNavbarHook('/');
        rerender();
        await waitFor(() => expect(pushClient.syncOnLoad).toHaveBeenCalledTimes(1));
        expect(pushClient.syncOnLoad).toHaveBeenCalledWith({ userId: 7 });
    });

    it('marks a tapped notification read and strips the param', async () => {
        api.markAsRead.mockResolvedValue({ data: { status: 'ok', unread_count: 2 } });
        const { result } = renderNavbarHook('/u/mika?notification=55&tab=lists');

        await waitFor(() => expect(api.markAsRead).toHaveBeenCalledWith(55));
        await waitFor(() => expect(result.current.location.search).toBe('?tab=lists'));
        expect(result.current.location.pathname).toBe('/u/mika');
        await waitFor(() => expect(result.current.count).toBe(2));
    });

    it('follows the service worker’s navigate message, same origin only', async () => {
        const { result } = renderNavbarHook('/');

        act(() => postFromWorker({ type: 'navigate', url: 'https://evil.test/x' }));
        expect(result.current.location.pathname).toBe('/');

        act(() => postFromWorker({ type: 'navigate', url: '/anime/frieren' }));
        await waitFor(() => expect(result.current.location.pathname).toBe('/anime/frieren'));
    });

    it('resyncs push when the subscription changed', async () => {
        renderNavbarHook('/');
        await waitFor(() => expect(pushClient.syncOnLoad).toHaveBeenCalledTimes(1));

        act(() => postFromWorker({ type: 'pushsubscriptionchange' }));
        expect(pushClient.syncOnLoad).toHaveBeenCalledTimes(2);
    });

    it('takes the count from socket events', async () => {
        const { result } = renderNavbarHook('/');
        await waitFor(() => expect(result.current.count).toBe(3));

        act(() => socket.options.onMessage({ type: 'notification_deleted', notification_id: 1, unread_count: 1 }));
        await waitFor(() => expect(result.current.count).toBe(1));
    });
});
