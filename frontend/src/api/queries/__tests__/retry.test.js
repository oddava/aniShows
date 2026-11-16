import { describe, expect, it, vi } from 'vitest';

import { retryUnlessClientError } from '../retry';

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

describe('retryUnlessClientError', () => {
    it.each([400, 401, 403, 404, 410, 422])('never retries a %i', (status) => {
        expect(retryUnlessClientError(0, httpError(status))).toBe(false);
    });

    it.each([408, 429, 500, 502, 503])('retries a %i once', (status) => {
        expect(retryUnlessClientError(0, httpError(status))).toBe(true);
        expect(retryUnlessClientError(1, httpError(status))).toBe(false);
    });

    it('retries a network error (no response) once', () => {
        const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
        expect(retryUnlessClientError(0, networkError)).toBe(true);
        expect(retryUnlessClientError(1, networkError)).toBe(false);
    });

    it('reads a bare status and tolerates errors that are not objects', () => {
        expect(retryUnlessClientError(0, { status: 404 })).toBe(false);
        expect(retryUnlessClientError(0, undefined)).toBe(true);
        expect(retryUnlessClientError(0, 'boom')).toBe(true);
    });
});

describe('app QueryClient', () => {
    it('uses retryUnlessClientError as the default query retry', async () => {
        vi.resetModules();
        const created = [];
        vi.doMock('@tanstack/react-query', async (importOriginal) => {
            const actual = await importOriginal();
            class RecordingQueryClient extends actual.QueryClient {
                constructor(config) {
                    super(config);
                    created.push(config);
                }
            }
            return { ...actual, QueryClient: RecordingQueryClient };
        });
        try {
            await import('../../../app/providers');
            // The same module instance providers.jsx imported (after resetModules).
            const retryModule = await import('../retry');
            expect(created).toHaveLength(1);
            expect(created[0].defaultOptions.queries.retry).toBe(retryModule.retryUnlessClientError);
            // Mutations keep TanStack's default (no retry).
            expect(created[0].defaultOptions.mutations).toBeUndefined();
        } finally {
            vi.doUnmock('@tanstack/react-query');
            vi.resetModules();
        }
    });
});
