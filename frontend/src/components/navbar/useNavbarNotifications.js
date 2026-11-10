import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { setUnreadNotificationCount, useUnreadNotificationCount } from '../../hooks/useNotifications';
import { useWebSocket } from '../../hooks/useWebSocket';

/**
 * The unread-notification count shown in the navbar: fetched when signed in,
 * cleared on the notifications page and kept current by WebSocket pushes.
 */
export default function useNavbarNotifications({ user, isAuthenticated }) {
    const location = useLocation();
    const queryClient = useQueryClient();
    const userId = user?.id;

    // Unread badge: fetched when signed in, then kept current by WebSocket pushes.
    const unreadCountQuery = useUnreadNotificationCount(userId, {
        enabled: isAuthenticated,
        errorLog: 'Failed to fetch mobile notification count:',
    });
    const mobileUnreadCount = isAuthenticated ? (unreadCountQuery.data ?? 0) : 0;

    // Opening the notifications page clears the badge.
    useEffect(() => {
        if (location.pathname === '/notifications') {
            setUnreadNotificationCount(queryClient, userId, 0);
        }
    }, [location.pathname, queryClient, userId]);

    const handleNotificationMessage = useCallback((data) => {
        if (data.type === 'unread_count') {
            setUnreadNotificationCount(queryClient, userId, data.count ?? 0);
            return;
        }
        if (data.type === 'notification' && data.unread_count != null) {
            setUnreadNotificationCount(queryClient, userId, data.unread_count);
            return;
        }
        if (data.type === 'notification_read' && data.unread_count != null) {
            setUnreadNotificationCount(queryClient, userId, data.unread_count);
        }
    }, [queryClient, userId]);

    useWebSocket(
        user ? '/ws/notifications/' : null,
        { onMessage: handleNotificationMessage },
        { autoConnect: !!user }
    );

    return mobileUnreadCount;
}
