const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || 'development';

export function initSentry() {
    if (SENTRY_DSN) {
        console.info('Sentry configured but package not installed');
    }
    return false;
}

export const Sentry = null;

export function captureException(error, context = {}) {
    console.error('[Error]', error, context);
}

export function captureMessage(message, level = 'info', context = {}) {
    const logFn = level === 'error' ? console.error : console.log;
    logFn(`[${level.toUpperCase()}]`, message, context);
}

export function setUserContext(user) {
    // setUserContext behavior removed to reduce console noise
}
