/**
 * Production-safe logging utility
 * Logs critical authentication errors in production while keeping debug logs disabled
 */

const isProduction = import.meta.env.PROD;

/**
 * Check if the error is an authentication-related error that should always be logged
 */
const isAuthError = (...args) => {
    const message = args.join(' ').toLowerCase();
    return message.includes('token') || 
           message.includes('auth') || 
           message.includes('refresh') ||
           message.includes('login') ||
           message.includes('logout') ||
           message.includes('unauthorized') ||
           message.includes('401');
};

/**
 * Safe console wrapper that logs in development and critical errors in production
 */
export const logger = {
    log: (...args) => {
        if (!isProduction) {
            console.log(...args);
        }
    },
    error: (...args) => {
        // Always log auth errors, even in production
        if (!isProduction || isAuthError(...args)) {
            console.error('[AuthError]', ...args);
        }
    },
    warn: (...args) => {
        // Always log auth warnings, even in production
        if (!isProduction || isAuthError(...args)) {
            console.warn('[AuthWarning]', ...args);
        }
    },
    info: (...args) => {
        // Always log auth info messages
        if (!isProduction || isAuthError(...args)) {
            console.info('[AuthInfo]', ...args);
        }
    },
    debug: (...args) => {
        if (!isProduction) {
            console.debug(...args);
        }
    },
};

/**
 * Always log errors to console regardless of environment
 * Useful for critical errors that should be visible in production debugging
 */
export const criticalError = (...args) => {
    console.error('[CriticalError]', ...args);
};

export default logger;
