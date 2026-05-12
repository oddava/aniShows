import { useRef, useEffect, useCallback, useState } from 'react';
import logger from '../utils/logger';

/**
 * Connection states for the WebSocket.
 */
export const WS_STATE = {
    CONNECTING: 'CONNECTING',
    OPEN: 'OPEN',
    CLOSING: 'CLOSING',
    CLOSED: 'CLOSED',
};

/**
 * Default configuration for the WebSocket hook.
 */
const DEFAULT_OPTIONS = {
    /** Maximum number of reconnect attempts before giving up. */
    maxRetries: 10,
    /** Base delay in ms between reconnect attempts (exponentially backed off). */
    baseDelay: 1000,
    /** Maximum delay in ms between reconnect attempts. */
    maxDelay: 30000,
    /** Interval in ms for sending heartbeat pings to keep connection alive. */
    heartbeatInterval: 30000,
    /** Whether to automatically connect on mount. */
    autoConnect: true,
};

/**
 * Build the full WebSocket URL with JWT token as a query parameter.
 *
 * @param {string} path - The WebSocket path (e.g., "/ws/notifications/").
 * @returns {string|null} Full WebSocket URL or null if no token.
 */
function buildWsUrl(path) {
    const token = localStorage.getItem('access_token');
    if (!token) return null;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}${path}?token=${token}`;
}

/**
 * Custom React hook for a reconnecting WebSocket connection with JWT auth.
 *
 * Features:
 * - Automatic reconnection with exponential backoff + jitter
 * - JWT token passed as query param for auth
 * - Heartbeat pings to detect dead connections
 * - Graceful cleanup on unmount
 * - Manual send/connect/disconnect controls
 *
 * @param {string} path - WebSocket path (e.g., "/ws/notifications/").
 * @param {Object} handlers - Event handler callbacks.
 * @param {function} [handlers.onMessage] - Called with parsed JSON message data.
 * @param {function} [handlers.onOpen] - Called when connection opens.
 * @param {function} [handlers.onClose] - Called when connection closes.
 * @param {function} [handlers.onError] - Called on connection error.
 * @param {Object} [options] - Configuration options (see DEFAULT_OPTIONS).
 * @returns {{ state: string, send: function, connect: function, disconnect: function }}
 */
export function useWebSocket(path, handlers = {}, options = {}) {
    const config = { ...DEFAULT_OPTIONS, ...options };
    const [state, setState] = useState(WS_STATE.CLOSED);

    // Refs to persist across renders without causing re-renders
    const wsRef = useRef(null);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef(null);
    const heartbeatTimerRef = useRef(null);
    const connectRef = useRef(null);
    const unmountedRef = useRef(false);

    // Keep handlers in a ref so we don't need them in dependency arrays
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    /**
     * Stop heartbeat pings.
     */
    const stopHeartbeat = useCallback(() => {
        if (heartbeatTimerRef.current) {
            clearInterval(heartbeatTimerRef.current);
            heartbeatTimerRef.current = null;
        }
    }, []);

    /**
     * Start heartbeat pings. Sends a `{"type": "ping"}` message at a
     * regular interval to keep the connection alive and detect dead sockets.
     */
    const startHeartbeat = useCallback(() => {
        stopHeartbeat();
        heartbeatTimerRef.current = setInterval(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                try {
                    wsRef.current.send(JSON.stringify({ type: 'ping' }));
                } catch {
                    // Socket may have closed between the check and the send
                }
            }
        }, config.heartbeatInterval);
    }, [config.heartbeatInterval, stopHeartbeat]);

    /**
     * Calculate reconnect delay with exponential backoff + jitter.
     */
    const getReconnectDelay = useCallback(() => {
        const exponential = Math.min(
            config.baseDelay * Math.pow(2, retryCountRef.current),
            config.maxDelay
        );
        // Add up to 25% jitter to prevent thundering herd
        const jitter = exponential * 0.25 * Math.random();
        return exponential + jitter;
    }, [config.baseDelay, config.maxDelay]);

    /**
     * Schedule a reconnection attempt.
     */
    const scheduleReconnect = useCallback(() => {
        if (unmountedRef.current) return;
        if (retryCountRef.current >= config.maxRetries) {
            logger.warn(`WebSocket: max retries (${config.maxRetries}) reached for ${path}`);
            return;
        }

        const delay = getReconnectDelay();
        logger.debug(`WebSocket: reconnecting in ${Math.round(delay)}ms (attempt ${retryCountRef.current + 1}/${config.maxRetries})`);

        retryTimerRef.current = setTimeout(() => {
            if (!unmountedRef.current) {
                retryCountRef.current += 1;
                connectRef.current?.();
            }
        }, delay);
    }, [config.maxRetries, getReconnectDelay, path]);

    /**
     * Open a new WebSocket connection.
     */
    const connect = useCallback(() => {
        // Close existing connection if any
        if (wsRef.current) {
            wsRef.current.onclose = null; // prevent reconnect loop
            wsRef.current.close();
            wsRef.current = null;
        }

        const url = buildWsUrl(path);
        if (!url) {
            logger.debug('WebSocket: no access token, skipping connection');
            return;
        }

        setState(WS_STATE.CONNECTING);

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                if (unmountedRef.current) return;
                logger.debug(`WebSocket: connected to ${path}`);
                setState(WS_STATE.OPEN);
                retryCountRef.current = 0; // Reset on successful connection
                startHeartbeat();
                handlersRef.current.onOpen?.();
            };

            ws.onmessage = (event) => {
                if (unmountedRef.current) return;
                try {
                    const data = JSON.parse(event.data);
                    // Silently swallow pong responses
                    if (data.type === 'pong') return;
                    handlersRef.current.onMessage?.(data);
                } catch {
                    logger.error('WebSocket: failed to parse message', event.data);
                }
            };

            ws.onerror = (event) => {
                if (unmountedRef.current) return;
                logger.error(`WebSocket: error on ${path}`);
                handlersRef.current.onError?.(event);
            };

            ws.onclose = (event) => {
                if (unmountedRef.current) return;
                stopHeartbeat();
                setState(WS_STATE.CLOSED);
                handlersRef.current.onClose?.(event);

                // Don't reconnect on clean close or auth rejection
                if (event.code === 1000 || event.code === 4401) {
                    logger.debug(`WebSocket: closed cleanly (code=${event.code})`);
                    return;
                }

                scheduleReconnect();
            };
        } catch (err) {
            logger.error('WebSocket: failed to create connection', err);
            setState(WS_STATE.CLOSED);
            scheduleReconnect();
        }
    }, [path, startHeartbeat, stopHeartbeat, scheduleReconnect]);
    connectRef.current = connect;

    /**
     * Manually disconnect the WebSocket. Does not trigger reconnect.
     */
    const disconnect = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        stopHeartbeat();
        retryCountRef.current = 0;

        if (wsRef.current) {
            wsRef.current.onclose = null; // prevent reconnect
            wsRef.current.close(1000, 'Client disconnect');
            wsRef.current = null;
        }
        setState(WS_STATE.CLOSED);
    }, [stopHeartbeat]);

    /**
     * Send a JSON message through the WebSocket.
     *
     * @param {Object} data - Data to send (will be JSON.stringify'd).
     * @returns {boolean} Whether the message was sent successfully.
     */
    const send = useCallback((data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
                wsRef.current.send(JSON.stringify(data));
                return true;
            } catch (err) {
                logger.error('WebSocket: send failed', err);
                return false;
            }
        }
        return false;
    }, []);

    // Auto-connect on mount, cleanup on unmount.
    // A small delay avoids a wasted connection in React StrictMode (dev only),
    // which unmounts and immediately remounts every component.
    useEffect(() => {
        unmountedRef.current = false;
        let connectTimer = null;

        if (config.autoConnect && path) {
            connectTimer = setTimeout(() => {
                if (!unmountedRef.current) {
                    connect();
                }
            }, 100);
        }

        return () => {
            unmountedRef.current = true;
            if (connectTimer) clearTimeout(connectTimer);
            disconnect();
        };
    }, [config.autoConnect, connect, disconnect, path]);

    return { state, send, connect, disconnect };
}
