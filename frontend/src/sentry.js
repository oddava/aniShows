import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || 'development';

/**
 * Initialize Sentry error monitoring.
 * Must be called before React renders (in main.jsx).
 * Returns true if Sentry was initialized, false otherwise.
 */
export function initSentry() {
    if (!SENTRY_DSN) {
        return false;
    }

    Sentry.init({
        dsn: SENTRY_DSN,
        environment: ENVIRONMENT,
        release: import.meta.env.VITE_SENTRY_RELEASE || '',

        integrations: [
            // Browser tracing for performance monitoring
            Sentry.browserTracingIntegration(),
            // Replay for session recording on errors
            Sentry.replayIntegration({
                maskAllText: false,
                blockAllMedia: false,
            }),
        ],

        // Performance monitoring - sample 10% of transactions
        tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'),

        // Session Replay - capture 0% of normal sessions, 100% of sessions with errors
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,

        // Only send events in production
        enabled: ENVIRONMENT === 'production',

        // Filter out noisy errors
        beforeSend(event, hint) {
            const error = hint?.originalException;

            // Ignore network errors (user offline, etc.)
            if (error?.message?.match(/Network Error|Failed to fetch|Load failed|AbortError/i)) {
                return null;
            }

            // Ignore ResizeObserver errors (browser quirk, not actionable)
            if (error?.message?.match(/ResizeObserver/i)) {
                return null;
            }

            // Ignore 401/403 responses (expected auth flows)
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return null;
            }

            return event;
        },

        // Don't send PII
        sendDefaultPii: false,
    });

    return true;
}

export { Sentry };

/**
 * Capture an exception with optional context.
 */
export function captureException(error, context = {}) {
    if (SENTRY_DSN) {
        Sentry.withScope((scope) => {
            if (context.tags) {
                Object.entries(context.tags).forEach(([key, value]) => {
                    scope.setTag(key, value);
                });
            }
            if (context.extra) {
                Object.entries(context.extra).forEach(([key, value]) => {
                    scope.setExtra(key, value);
                });
            }
            if (context.level) {
                scope.setLevel(context.level);
            }
            Sentry.captureException(error);
        });
    } else {
        console.error('[Error]', error, context);
    }
}

/**
 * Capture a message with optional level and context.
 */
export function captureMessage(message, level = 'info', context = {}) {
    if (SENTRY_DSN) {
        Sentry.withScope((scope) => {
            if (context.tags) {
                Object.entries(context.tags).forEach(([key, value]) => {
                    scope.setTag(key, value);
                });
            }
            if (context.extra) {
                Object.entries(context.extra).forEach(([key, value]) => {
                    scope.setExtra(key, value);
                });
            }
            Sentry.captureMessage(message, level);
        });
    } else {
        const logFn = level === 'error' ? console.error : console.log;
        logFn(`[${level.toUpperCase()}]`, message, context);
    }
}

/**
 * Set user context for Sentry events.
 */
export function setUserContext(user) {
    if (!SENTRY_DSN || !user) {
        return;
    }

    Sentry.setUser({
        id: user.id?.toString(),
        username: user.username,
    });
}

/**
 * Clear user context (call on logout).
 */
export function clearUserContext() {
    if (SENTRY_DSN) {
        Sentry.setUser(null);
    }
}
