import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useFreshError, useReportError } from '../useQueryErrorReport';

const { toastError, logError } = vi.hoisted(() => ({ toastError: vi.fn(), logError: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: toastError } }));
vi.mock('../../utils/logger', () => ({ default: { error: logError } }));

beforeEach(() => {
    toastError.mockReset();
    logError.mockReset();
});

describe('useFreshError', () => {
    it('ignores an error that predates looking at the key', () => {
        const old = { error: new Error('old'), errorUpdatedAt: Date.now() - 1000 };
        const { result } = renderHook(() => useFreshError(old, ['k', 1]));
        expect(result.current).toBeNull();
    });

    it('returns an error that happened afterwards', () => {
        const { result, rerender } = renderHook(({ query }) => useFreshError(query, ['k', 1]), {
            initialProps: { query: { error: null, errorUpdatedAt: 0 } },
        });
        const error = new Error('new');
        rerender({ query: { error, errorUpdatedAt: Date.now() + 1 } });
        expect(result.current).toBe(error);
    });

    it('starts over when the key changes', () => {
        const error = new Error('page 2');
        const { result, rerender } = renderHook(({ key, query }) => useFreshError(query, key), {
            initialProps: { key: ['k', 2], query: { error: null, errorUpdatedAt: 0 } },
        });
        const failedAt = Date.now() + 1;
        rerender({ key: ['k', 2], query: { error, errorUpdatedAt: failedAt } });
        expect(result.current).toBe(error);

        // Back on page 2 later: its cached error is not this visit's.
        rerender({ key: ['k', 1], query: { error: null, errorUpdatedAt: 0 } });
        const later = vi.spyOn(Date, 'now').mockReturnValue(failedAt + 5000);
        rerender({ key: ['k', 2], query: { error, errorUpdatedAt: failedAt } });
        expect(result.current).toBeNull();
        later.mockRestore();
    });
});

describe('useReportError', () => {
    it('logs and toasts once per failure', () => {
        const error = new Error('x');
        const { rerender } = renderHook(({ e, at }) => useReportError(e, at, { log: 'Failed:', toastMessage: 'Oops' }), {
            initialProps: { e: error, at: 1 },
        });
        rerender({ e: error, at: 1 });
        expect(logError).toHaveBeenCalledTimes(1);
        expect(toastError).toHaveBeenCalledTimes(1);

        rerender({ e: error, at: 2 });
        expect(logError).toHaveBeenCalledTimes(2);
        expect(toastError).toHaveBeenCalledTimes(2);
    });

    it('builds the toast from the error, and can stay silent', () => {
        const error = { response: { data: { detail: 'Nope' } } };
        renderHook(() => useReportError(error, 1, { toastMessage: (e) => e.response.data.detail }));
        expect(toastError).toHaveBeenCalledWith('Nope');
        expect(logError).not.toHaveBeenCalled();

        renderHook(() => useReportError(error, 1, { log: 'x', toastMessage: 'y', skip: true }));
        renderHook(() => useReportError(null, 0, { log: 'x', toastMessage: 'y' }));
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(logError).not.toHaveBeenCalled();
    });
});
