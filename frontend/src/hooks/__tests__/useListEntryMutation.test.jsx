import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import useListEntryMutation from '../useListEntryMutation';

const listApi = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());

vi.mock('../../api/client', () => ({ listApi, animeApi: {}, authApi: {} }));
vi.mock('../../utils/logger', () => ({ default: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const anime = { id: 7, slug: 'frieren', episode_count: 28 };

function setup(entry) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useListEntryMutation({ anime, entry }), { wrapper });
    return { ...hook, invalidate };
}

const invalidatedKeys = (spy) => spy.mock.calls.map(([arg]) => arg.queryKey);

beforeEach(() => {
    Object.values(listApi).forEach((mock) => mock.mockReset());
    logError.mockReset();
});

describe('useListEntryMutation (G3 contract stub, AnimeCard behaviour)', () => {
    it('adds a new entry and invalidates what AnimeCard invalidates', async () => {
        listApi.add.mockResolvedValue({ data: { id: 41 } });
        const { result, invalidate } = setup(null);

        await act(() => result.current.setStatus('Watching'));

        expect(listApi.add).toHaveBeenCalledWith({ anime_id: 7, status: 'Watching' });
        expect(result.current.entry).toMatchObject({ id: 41, status: 'Watching' });
        expect(invalidatedKeys(invalidate)).toEqual([
            ['anime'], ['seasonal'], ['lists'], ['user', 'list', 'watching'], ['ownProfile'],
        ]);
    });

    it('updates an existing entry and increments progress', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3 } });
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 4 });

        await act(() => result.current.increment());

        expect(listApi.update).toHaveBeenCalledWith(3, { episodes_watched: 5 });
        expect(result.current.entry.episodes_watched).toBe(5);
    });

    it('rolls back and logs when the request fails', async () => {
        listApi.update.mockRejectedValue(new Error('offline'));
        const { result, invalidate } = setup({ id: 3, status: 'Watching', episodes_watched: 4 });

        await act(() => result.current.setStatus('Completed'));

        expect(result.current.entry).toMatchObject({ id: 3, status: 'Watching' });
        expect(logError).toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('removes the entry', async () => {
        listApi.remove.mockResolvedValue({});
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 4 });

        await act(() => result.current.remove());

        expect(listApi.remove).toHaveBeenCalledWith(3);
        expect(result.current.entry).toMatchObject({ id: null, status: null });
    });
});
