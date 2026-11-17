import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import useListEntryMutation, { listErrorMessage } from '../useListEntryMutation';

const listApi = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }));
const patchAnimeListStatus = vi.hoisted(() => vi.fn());

vi.mock('../../api/client', () => ({ listApi, animeApi: {}, authApi: {}, activityApi: {}, reviewApi: {} }));
vi.mock('../../api/queries/anime', () => ({
    animeKeys: { all: ['anime'], bySlug: (slug) => ['anime', slug] },
    patchAnimeListStatus,
}));
vi.mock('react-hot-toast', () => ({ default: toastMock }));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const anime = { id: 7, slug: 'frieren', episode_count: 28 };

function setup(entry, animeOverride = anime) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useListEntryMutation({ anime: animeOverride, entry }), { wrapper });
    return { ...hook, invalidate };
}

const invalidatedKeys = (spy) => spy.mock.calls.map(([arg]) => arg.queryKey);
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

beforeEach(() => {
    Object.values(listApi).forEach((mock) => mock.mockReset());
    toastMock.mockReset();
    toastMock.error.mockReset();
    toastMock.dismiss.mockReset();
    patchAnimeListStatus.mockReset();
});

describe('useListEntryMutation', () => {
    it('adds a new entry, adopts the server entry and refreshes only list caches', async () => {
        listApi.add.mockResolvedValue({ data: { id: 41, status: 'Watching', episodes_watched: 0, started_at: '2026-11-16' } });
        const { result, invalidate } = setup(null);

        await act(() => result.current.setStatus('Watching'));

        expect(listApi.add).toHaveBeenCalledWith({ anime_id: 7, status: 'Watching' });
        expect(result.current.entry).toMatchObject({ id: 41, status: 'Watching', started_at: '2026-11-16' });
        const keys = invalidatedKeys(invalidate);
        expect(keys).toEqual(expect.arrayContaining([
            ['lists'], ['user', 'list', 'watching'], ['ownProfile'],
            ['activity-heatmap'], ['activity-feed'], ['anime', 'frieren'],
        ]));
        expect(keys).not.toContainEqual(['anime']);
        expect(keys).not.toContainEqual(['seasonal']);
        expect(patchAnimeListStatus).toHaveBeenCalledWith(
            expect.anything(), 7, expect.objectContaining({ id: 41, status: 'Watching' }),
        );
    });

    it('applies the change optimistically, then rolls back with the server message', async () => {
        const pending = deferred();
        listApi.update.mockReturnValue(pending.promise);
        const { result, invalidate } = setup({ id: 3, status: 'Watching', episodes_watched: 4 });

        let call;
        act(() => { call = result.current.setStatus('Completed'); });
        expect(result.current.entry.status).toBe('Completed');
        expect(result.current.isPending).toBe(true);

        await act(async () => {
            pending.reject({ response: { data: { episodes_watched: ['Too many episodes.'] } } });
            await call;
        });

        expect(result.current.entry).toMatchObject({ id: 3, status: 'Watching', episodes_watched: 4 });
        expect(toastMock.error).toHaveBeenCalledWith('Too many episodes.');
        expect(invalidate).not.toHaveBeenCalled();
        expect(result.current.isPending).toBe(false);
    });

    it('adopts the normalised entry the server returns', async () => {
        listApi.update.mockResolvedValue({
            data: { id: 3, status: 'Completed', episodes_watched: 28, finished_at: '2026-11-16' },
        });
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 27 });

        await act(() => result.current.increment());

        expect(listApi.update).toHaveBeenCalledWith(3, { episodes_watched: 28 });
        expect(result.current.entry).toMatchObject({ status: 'Completed', episodes_watched: 28, finished_at: '2026-11-16' });
    });

    it('caps +1 at the known total', async () => {
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 28 });

        await act(() => result.current.increment());
        await act(() => result.current.setProgress(40));

        expect(listApi.update).toHaveBeenCalledTimes(1);
        expect(listApi.update).toHaveBeenCalledWith(3, { episodes_watched: 28 });
    });

    it('does not cap when the episode count is unknown', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Watching', episodes_watched: 13 } });
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 12 }, { id: 7, slug: 'op', episode_count: 0 });

        await act(() => result.current.increment());

        expect(listApi.update).toHaveBeenCalledWith(3, { episodes_watched: 13 });
    });

    it('removes the entry and re-adds the previous payload on undo', async () => {
        listApi.remove.mockResolvedValue({});
        listApi.add.mockResolvedValue({ data: { id: 9, status: 'Completed', score: 8, episodes_watched: 28 } });
        const previous = {
            id: 3, status: 'Completed', score: 8, episodes_watched: 28, notes: 'Great',
            started_at: '2026-01-01', finished_at: '2026-02-01', total_rewatches: 1, is_rewatching: false,
        };
        const { result } = setup(previous);

        await act(() => result.current.remove());

        expect(listApi.remove).toHaveBeenCalledWith(3);
        expect(result.current.entry).toMatchObject({ id: null, status: null });
        expect(patchAnimeListStatus).toHaveBeenLastCalledWith(expect.anything(), 7, null);

        const renderToast = toastMock.mock.calls[0][0];
        const element = renderToast({ id: 't1' });
        const undoButton = element.props.children.find((child) => child?.props?.onClick);
        await act(async () => { await undoButton.props.onClick(); });

        expect(toastMock.dismiss).toHaveBeenCalledWith('t1');
        expect(listApi.add).toHaveBeenCalledWith({
            anime_id: 7, status: 'Completed', score: 8, episodes_watched: 28, notes: 'Great',
            started_at: '2026-01-01', finished_at: '2026-02-01', total_rewatches: 1,
        });
        expect(result.current.entry).toMatchObject({ id: 9, status: 'Completed' });
    });

    it('ignores a second write while one is in flight', async () => {
        const pending = deferred();
        listApi.update.mockReturnValue(pending.promise);
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 4 });

        let first;
        act(() => { first = result.current.increment(); });
        let second;
        await act(async () => { second = await result.current.increment(); });
        await act(async () => {
            pending.resolve({ data: { id: 3, status: 'Watching', episodes_watched: 5 } });
            await first;
        });

        expect(second).toBeNull();
        expect(listApi.update).toHaveBeenCalledTimes(1);
    });

    it('starts a rewatch through the server', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Watching', episodes_watched: 0, is_rewatching: true } });
        const { result } = setup({ id: 3, status: 'Completed', episodes_watched: 28 });

        await act(() => result.current.startRewatch());

        expect(listApi.update).toHaveBeenCalledWith(3, { is_rewatching: true });
        expect(result.current.entry).toMatchObject({ status: 'Watching', is_rewatching: true });
    });
});

describe('listErrorMessage', () => {
    it('reads detail, then the first field error, then falls back', () => {
        expect(listErrorMessage({ response: { data: { detail: 'Nope' } } })).toBe('Nope');
        expect(listErrorMessage({ response: { data: { notes: ['Too long'] } } })).toBe('Too long');
        expect(listErrorMessage(new Error('offline'))).toBe('Could not update your list.');
    });
});
