import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import {
    setUnreadNotificationCount,
    useMarkNotificationRead,
    useUnreadNotificationCount,
} from '../../hooks/useNotifications';
import logger from '../../utils/logger';
import { useNotificationSocket } from '../notifications/notificationSocket';
import { syncOnLoad } from '../notifications/pushClient';

/** A same-origin path from a service-worker message, or null. */
const toSameOriginPath = (url) => {
    if (typeof url !== 'string' || !url) return null;
    try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.origin !== window.location.origin) return null;
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return null;
    }
};

/**
 * The unread-notification count shown in the navbar. It is always the
 * server's count: fetched when signed in and kept current by the shared
 * notification socket.
 *
 * Mounted on every page, it also does the app side of web push: syncs this
 * browser's subscription once per signed-in user, marks a notification read
 * when a push tap lands on `?notification=<id>` (and strips the param), and
 * follows the service worker's `navigate` / `pushsubscriptionchange` messages.
 */
export default function useNavbarNotifications({ user, isAuthenticated }) {
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const userId = user?.id;
    const signedIn = Boolean(isAuthenticated && userId != null);

    const unreadCountQuery = useUnreadNotificationCount(userId, {
        enabled: isAuthenticated,
        errorLog: 'Failed to fetch mobile notification count:',
    });
    const mobileUnreadCount = isAuthenticated ? (unreadCountQuery.data ?? 0) : 0;

    const handleNotificationMessage = useCallback((data) => {
        if (data.type === 'unread_count') {
            setUnreadNotificationCount(queryClient, userId, data.count ?? 0);
            return;
        }
        if (
            (data.type === 'notification' || data.type === 'notification_read' || data.type === 'notification_deleted')
            && data.unread_count != null
        ) {
            setUnreadNotificationCount(queryClient, userId, data.unread_count);
        }
    }, [queryClient, userId]);

    useNotificationSocket({
        userId,
        queryClient,
        onMessage: handleNotificationMessage,
        enabled: signedIn,
    });

    // Push: keep this browser's subscription in step, once per signed-in user.
    const syncedUserRef = useRef(null);
    useEffect(() => {
        if (!signedIn || syncedUserRef.current === userId) return;
        syncedUserRef.current = userId;
        syncOnLoad({ userId });
    }, [signedIn, userId]);

    // A tapped push lands on `?notification=<id>`: mark it read, then drop the param.
    const { mutateAsync: markRead } = useMarkNotificationRead(userId);
    const tappedId = new URLSearchParams(location.search).get('notification');
    useEffect(() => {
        if (!signedIn || tappedId == null) return;
        const params = new URLSearchParams(location.search);
        params.delete('notification');
        const search = params.toString();
        navigate(
            { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
            { replace: true, state: location.state },
        );
        if (/^\d+$/.test(tappedId)) {
            markRead(Number(tappedId)).catch((error) => {
                logger.warn('Failed to mark the opened notification as read:', error);
            });
        }
    }, [signedIn, tappedId, location.pathname, location.search, location.hash, location.state, navigate, markRead]);

    // Messages from the service worker.
    useEffect(() => {
        const container = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
        if (!container?.addEventListener) return undefined;

        const handleMessage = (event) => {
            const message = event?.data;
            if (message?.type === 'navigate') {
                const path = toSameOriginPath(message.url);
                if (path) navigate(path);
                return;
            }
            if (message?.type === 'pushsubscriptionchange' && signedIn) {
                syncOnLoad({ userId });
            }
        };

        container.addEventListener('message', handleMessage);
        container.startMessages?.();
        return () => container.removeEventListener('message', handleMessage);
    }, [navigate, signedIn, userId]);

    return mobileUnreadCount;
}
