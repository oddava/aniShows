import { lazy } from 'react';

/*
 * React.lazy with one retry when a chunk fails to load (stale deploy, flaky network).
 * Shared by every route module under app/routes/. Frozen: integrator only.
 */
const lazyWithRetry = (importer, retries = 1, retryDelayMs = 250) => lazy(async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await importer();
        } catch (error) {
            lastError = error;
            const message = (error?.message || '').toLowerCase();
            const isModuleLoadFailure =
                message.includes('failed to fetch dynamically imported module') ||
                message.includes('error loading dynamically imported module');

            if (!isModuleLoadFailure || attempt === retries) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
    }

    throw lastError;
});

export default lazyWithRetry;
