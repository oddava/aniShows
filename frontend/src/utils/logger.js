/**
 * Production-safe logging utility
 * Disables console methods in production environment
 */

const isProduction = import.meta.env.PROD;

/**
 * Safe console wrapper that only logs in development
 */
export const logger = {
    log: (...args) => {
        if (!isProduction) {
            console.log(...args);
        }
    },
    error: (...args) => {
        if (!isProduction) {
            console.error(...args);
        }
    },
    warn: (...args) => {
        if (!isProduction) {
            console.warn(...args);
        }
    },
    info: (...args) => {
        if (!isProduction) {
            console.info(...args);
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
    console.error(...args);
};

export default logger;
