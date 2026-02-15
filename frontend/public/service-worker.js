// Service Worker for Push Notifications
const CACHE_NAME = 'anishows-notifications-v1';

// Install event - cache essential files
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
    if (!event.data) {
        console.log('Push event received without data');
        return;
    }

    let payload;
    try {
        payload = event.data.json();
    } catch (e) {
        payload = {
            title: 'aniShows',
            body: event.data.text()
        };
    }

    const title = payload.title || 'aniShows';
    const options = {
        body: payload.body || payload.message || 'New notification',
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        tag: payload.tag || 'default',
        requireInteraction: false,
        data: payload.data || {}
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const data = event.notification.data;
    let url = '/';

    // Navigate to relevant page based on notification type
    if (data?.anime_slug) {
        url = `/anime/${data.anime_slug}`;
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clientList) => {
            // If a window client is already open, focus it
            for (const client of clientList) {
                if (client.url === url && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise, open a new window
            if (self.clients.openWindow) {
                return self.clients.openWindow(url);
            }
        })
    );
});

// Message event - handle messages from the main thread
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
