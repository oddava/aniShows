import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Runs public/service-worker.js against a mocked `self`, so the push and
 * click handlers are tested as the file the browser loads.
 */

// Vitest runs from frontend/.
const SOURCE = readFileSync(resolve(cwd(), 'public/service-worker.js'), 'utf8');
const ORIGIN = 'https://anishows.test';

const loadWorker = ({ clients = [] } = {}) => {
    const listeners = {};
    const self = {
        location: { origin: ORIGIN },
        addEventListener: (type, handler) => {
            listeners[type] = handler;
        },
        skipWaiting: vi.fn(),
        registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
        navigator: { setAppBadge: vi.fn().mockResolvedValue(undefined) },
        clients: {
            claim: vi.fn().mockResolvedValue(undefined),
            matchAll: vi.fn().mockResolvedValue(clients),
            openWindow: vi.fn().mockResolvedValue(null),
        },
    };
    new Function('self', SOURCE)(self);

    /** Dispatches an event; resolves once everything passed to waitUntil settles. */
    const fire = async (type, event = {}) => {
        const waits = [];
        listeners[type]({ ...event, waitUntil: (promise) => waits.push(promise) });
        await Promise.all(waits);
    };
    return { self, listeners, fire };
};

const pushEvent = (payload) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });

const clickEvent = (data) => ({ notification: { data, close: vi.fn() } });

const windowClient = (url, { navigate = vi.fn().mockResolvedValue({}) } = {}) => {
    const client = { url, postMessage: vi.fn(), navigate };
    client.focus = vi.fn().mockResolvedValue(client);
    return client;
};

describe('service worker', () => {
    beforeEach(() => vi.clearAllMocks());

    it('has no fetch handler (no caching)', () => {
        const { listeners } = loadWorker();
        expect(listeners.fetch).toBeUndefined();
        expect(SOURCE).not.toMatch(/CACHE_NAME|icon-192x192|badge-72x72/);
    });

    it('shows a v1 payload and sets the app badge', async () => {
        const { self, fire } = loadWorker();
        await fire('push', pushEvent({
            v: 1,
            title: 'New follower',
            body: 'mika followed you',
            url: '/u/mika',
            tag: 'follow:12',
            notification_id: 55,
            unread_count: 3,
        }));

        expect(self.registration.showNotification).toHaveBeenCalledWith('New follower', {
            body: 'mika followed you',
            tag: 'follow:12',
            renotify: true,
            icon: '/anishows-icon-192.png',
            data: { url: '/u/mika', id: 55 },
        });
        expect(self.navigator.setAppBadge).toHaveBeenCalledWith(3);
    });

    it('does not renotify without a tag and falls back to a default title', async () => {
        const { self, fire } = loadWorker();
        await fire('push', pushEvent({ v: 1, body: 'Hello', url: '/' }));

        const [title, options] = self.registration.showNotification.mock.calls[0];
        expect(title).toBe('AniShows');
        expect(options.renotify).toBe(false);
        expect(options.tag).toBeUndefined();
        expect(self.navigator.setAppBadge).not.toHaveBeenCalled();
    });

    it('focuses an open tab and navigates it, with the notification id', async () => {
        const client = windowClient(`${ORIGIN}/browse`);
        const { self, fire } = loadWorker({ clients: [client] });
        const event = clickEvent({ url: '/anime/frieren', id: 9 });

        await fire('notificationclick', event);

        expect(event.notification.close).toHaveBeenCalled();
        expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
        expect(client.focus).toHaveBeenCalled();
        expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/anime/frieren?notification=9`);
        expect(self.clients.openWindow).not.toHaveBeenCalled();
    });

    it('asks the app to navigate when the tab cannot be navigated', async () => {
        const client = windowClient(`${ORIGIN}/`, { navigate: vi.fn().mockRejectedValue(new TypeError('uncontrolled')) });
        const { fire } = loadWorker({ clients: [client] });

        await fire('notificationclick', clickEvent({ url: '/u/mika', id: 4 }));

        expect(client.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '/u/mika?notification=4' });
    });

    it('opens a window when no tab of this site is open', async () => {
        const { self, fire } = loadWorker({ clients: [windowClient('https://elsewhere.test/')] });

        await fire('notificationclick', clickEvent({ url: '/forums/thread/3', id: 2 }));

        expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/forums/thread/3?notification=2`);
    });

    it('rejects cross-origin URLs and opens the home page instead', async () => {
        const { self, fire } = loadWorker();

        await fire('notificationclick', clickEvent({ url: 'https://evil.test/phish', id: 1 }));
        await fire('notificationclick', clickEvent({ url: '//evil.test/x' }));

        expect(self.clients.openWindow).toHaveBeenNthCalledWith(1, `${ORIGIN}/?notification=1`);
        expect(self.clients.openWindow).toHaveBeenNthCalledWith(2, `${ORIGIN}/`);
    });

    it('tells open tabs to sync when the subscription changes', async () => {
        const client = windowClient(`${ORIGIN}/`);
        const { fire } = loadWorker({ clients: [client] });

        await fire('pushsubscriptionchange');

        expect(client.postMessage).toHaveBeenCalledWith({ type: 'pushsubscriptionchange' });
    });
});
