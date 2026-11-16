import { useEffect, useRef } from 'react';

import { isAuthFailureError } from '../../api/httpClient';
import { notificationKeys } from '../../api/queries/notifications';
import { buildWsUrl } from '../../hooks/useWebSocket';
import logger from '../../utils/logger';

/*
 * One `/ws/notifications/` socket per tab, shared by everything that listens
 * (the navbar badge and the /notifications page). It is ref-counted: the first
 * subscriber opens it, the last one to leave closes it. It uses the same
 * single-use ticket flow and backoff as useWebSocket, resumes on `online` and
 * when the tab is shown again after giving up, and on every reopen after a
 * drop it invalidates the user's notification queries, because events sent
 * while it was down are lost.
 */

export const NOTIFICATION_SOCKET_PATH = '/ws/notifications/';

const MAX_RETRIES = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;
// Lets React StrictMode's mount-unmount-mount settle before a socket opens.
const CONNECT_DELAY = 100;

const subscribers = new Set();
let socket = null;
let socketUserId = null;
let attempt = 0;
let retries = 0;
let gaveUp = false;
let hasOpened = false;
let connectTimer = null;
let retryTimer = null;
let heartbeatTimer = null;
let windowListeners = false;

const clearTimers = () => {
    clearTimeout(connectTimer);
    clearTimeout(retryTimer);
    clearInterval(heartbeatTimer);
    connectTimer = null;
    retryTimer = null;
    heartbeatTimer = null;
};

const closeSocket = (code = 1000) => {
    if (!socket) return;
    const current = socket;
    socket = null;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
        current.close(code, 'Client disconnect');
    } catch {
        // Already closed.
    }
};

const dispatch = (data) => {
    subscribers.forEach((subscriber) => {
        try {
            subscriber.onMessage?.(data);
        } catch (error) {
            logger.error('Notification socket: listener failed', error);
        }
    });
};

/** Refetch what may have been missed, once per (query client, user). */
const invalidateAfterReopen = () => {
    const done = new Map();
    subscribers.forEach(({ queryClient, userId }) => {
        if (!queryClient) return;
        const users = done.get(queryClient) || new Set();
        const userKey = String(userId ?? 'anonymous');
        if (users.has(userKey)) return;
        users.add(userKey);
        done.set(queryClient, users);
        queryClient.invalidateQueries({ queryKey: notificationKeys.forUser(userId) });
    });
};

const scheduleReconnect = () => {
    if (subscribers.size === 0) return;
    if (retries >= MAX_RETRIES) {
        gaveUp = true;
        logger.warn(`Notification socket: gave up after ${MAX_RETRIES} retries`);
        return;
    }
    const exponential = Math.min(BASE_DELAY * 2 ** retries, MAX_DELAY);
    const delay = exponential + exponential * 0.25 * Math.random();
    retryTimer = setTimeout(() => {
        retryTimer = null;
        retries += 1;
        connect();
    }, delay);
};

async function connect() {
    closeSocket();
    const thisAttempt = ++attempt;
    gaveUp = false;

    let url;
    try {
        url = await buildWsUrl(NOTIFICATION_SOCKET_PATH);
    } catch (error) {
        if (thisAttempt !== attempt || subscribers.size === 0) return;
        if (isAuthFailureError(error)) return;
        logger.warn('Notification socket: could not get a ticket', error?.message);
        scheduleReconnect();
        return;
    }
    if (thisAttempt !== attempt || subscribers.size === 0 || !url) return;

    let ws;
    try {
        ws = new WebSocket(url);
    } catch (error) {
        logger.error('Notification socket: failed to open', error);
        scheduleReconnect();
        return;
    }
    socket = ws;

    ws.onopen = () => {
        retries = 0;
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                try {
                    socket.send(JSON.stringify({ type: 'ping' }));
                } catch {
                    // Closed between the check and the send.
                }
            }
        }, HEARTBEAT_INTERVAL);
        if (hasOpened) invalidateAfterReopen();
        hasOpened = true;
    };

    ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            logger.error('Notification socket: unreadable message', event.data);
            return;
        }
        if (data?.type === 'pong') return;
        dispatch(data);
    };

    ws.onclose = (event) => {
        if (socket !== ws) return;
        socket = null;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        // Clean close or "not signed in": don't retry.
        if (event?.code === 1000 || event?.code === 4401) return;
        scheduleReconnect();
    };
}

const resume = () => {
    if (subscribers.size === 0 || !gaveUp) return;
    gaveUp = false;
    retries = 0;
    connect();
};

const handleVisibility = () => {
    if (document.visibilityState === 'visible') resume();
};

const addWindowListeners = () => {
    if (windowListeners || typeof window === 'undefined') return;
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', handleVisibility);
    windowListeners = true;
};

const removeWindowListeners = () => {
    if (!windowListeners) return;
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', handleVisibility);
    windowListeners = false;
};

const start = () => {
    addWindowListeners();
    if (socket || connectTimer || retryTimer) return;
    connectTimer = setTimeout(() => {
        connectTimer = null;
        connect();
    }, CONNECT_DELAY);
};

const stop = () => {
    attempt += 1;
    clearTimers();
    closeSocket();
    removeWindowListeners();
    retries = 0;
    gaveUp = false;
    hasOpened = false;
    socketUserId = null;
};

/**
 * Listens on the shared socket. `subscriber` is `{onMessage, queryClient, userId}`;
 * `queryClient` and `userId` say which notification queries to refresh after a
 * reconnect. Returns the unsubscribe function.
 */
export function subscribeNotificationSocket(subscriber) {
    // A different account's listener: the open socket belongs to the old session.
    if (subscribers.size > 0 && socketUserId !== (subscriber.userId ?? null)) {
        stop();
        subscribers.clear();
    }
    socketUserId = subscriber.userId ?? null;
    subscribers.add(subscriber);
    start();

    return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size === 0) stop();
    };
}

/** Sends a JSON message on the shared socket when it is open. */
export function sendNotificationSocket(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
        socket.send(JSON.stringify(data));
        return true;
    } catch {
        return false;
    }
}

/**
 * React binding: listens while `enabled` (signed in). `onMessage` may change
 * between renders without reconnecting.
 */
export function useNotificationSocket({ userId, queryClient, onMessage, enabled = true }) {
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;

    useEffect(() => {
        if (!enabled || userId == null) return undefined;
        return subscribeNotificationSocket({
            userId,
            queryClient,
            onMessage: (data) => onMessageRef.current?.(data),
        });
    }, [enabled, queryClient, userId]);
}

/** Test helper: forget all state. */
export function resetNotificationSocketForTests() {
    stop();
    subscribers.clear();
}
