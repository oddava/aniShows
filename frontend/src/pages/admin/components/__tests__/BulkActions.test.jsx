import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useBulkDelete } from '../BulkActions';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock('../../../../api/client', () => ({ default: { post: (...args) => postMock(...args) } }));

const wrapper = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useBulkDelete', () => {
    it('ignores a second start while the first is pending, and settles it on cancel', async () => {
        let finishDryRun;
        postMock.mockImplementation(() => new Promise((resolve) => { finishDryRun = resolve; }));
        const { result } = renderHook(() => useBulkDelete({ entityType: 'genre', noun: 'genres' }), { wrapper });

        let first;
        let second;
        await act(async () => {
            first = result.current.start([1, 2]);
            second = result.current.start([1, 2]);
        });
        expect(await second).toBeNull();
        expect(postMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            finishDryRun({ data: { dry_run: true, matched: 2, would_delete_by_model: { 'anime.Genre': 2 } } });
        });
        // The dialog is up; cancelling it resolves the first call with null.
        await act(async () => {
            result.current.dialog.props.onCancel();
        });
        expect(await first).toBeNull();

        // And a new start works again afterwards.
        postMock.mockResolvedValue({ data: { dry_run: true, matched: 1, would_delete_by_model: {} } });
        await act(async () => { result.current.start([3]); });
        expect(postMock).toHaveBeenCalledTimes(2);
    });
});
