// AniShows service worker: web push only.
//
// Caching is intentionally absent. There is no fetch handler, so every request
// goes to the network exactly as without a service worker, and nothing
// (least of all authenticated API responses) is kept in CacheStorage.
//
// Push payload v1 (from the backend, at most 1 KB):
//   {v: 1, title, body, url, tag, notification_id, unread_count}
// `url` is a same-origin path; anything else opens the home page.

const DEFAULT_TITLE = 'AniShows';
const ICON = '/favicon.png';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

const parsePayload = (data) => {
    if (!data) return {};
    try {
        const parsed = data.json();
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        try {
            return { body: data.text() };
        } catch {
            return {};
        }
    }
};

const text = (value) => (typeof value === 'string' && value.trim() ? value : '');

/** The click target as a URL on this origin; anything off-origin or malformed becomes '/'. */
const safeTarget = (url) => {
    const origin = self.location.origin;
    try {
        const target = new URL(typeof url === 'string' && url ? url : '/', origin);
        if (target.origin === origin) return target;
    } catch {
        // Fall through to the home page.
    }
    return new URL('/', origin);
};

self.addEventListener('push', (event) => {
    const payload = parsePayload(event.data);
    const title = text(payload.title) || DEFAULT_TITLE;
    const tag = text(payload.tag);
    const options = {
        body: text(payload.body) || 'You have a new notification.',
        tag: tag || undefined,
        renotify: !!tag,
        icon: ICON,
        data: {
            url: text(payload.url) || '/',
            id: payload.notification_id ?? null,
        },
    };

    const jobs = [self.registration.showNotification(title, options)];
    if (typeof payload.unread_count === 'number' && self.navigator?.setAppBadge) {
        jobs.push(Promise.resolve(self.navigator.setAppBadge(payload.unread_count)).catch(() => {}));
    }
    event.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const data = event.notification.data || {};
    const target = safeTarget(data.url);
    if (data.id != null && /^\d+$/.test(String(data.id))) {
        target.searchParams.set('notification', String(data.id));
    }
    const href = target.href;
    const path = `${target.pathname}${target.search}${target.hash}`;

    event.waitUntil((async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const client = clientList.find((candidate) => {
            try {
                return new URL(candidate.url).origin === self.location.origin;
            } catch {
                return false;
            }
        });

        if (!client) {
            if (self.clients.openWindow) await self.clients.openWindow(href);
            return;
        }

        let focused = client;
        try {
            focused = (await client.focus()) || client;
        } catch {
            // Focus can fail without a user gesture; still try to navigate.
        }

        if (typeof focused.navigate === 'function') {
            try {
                if (await focused.navigate(href)) return;
            } catch {
                // Uncontrolled clients can't be navigated: let the app do it.
            }
        }
        focused.postMessage({ type: 'navigate', url: path });
    })());
});

// The browser replaced or dropped the subscription. Without auth the worker
// can't tell the server, so it asks any open tab to sync (pushClient.syncOnLoad).
self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            clientList.forEach((client) => client.postMessage({ type: 'pushsubscriptionchange' }));
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
