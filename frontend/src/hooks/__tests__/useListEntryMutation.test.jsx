import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import useListEntryMutation, { describeListChange, listErrorMessage } from '../useListEntryMutation';

const listApi = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
const toastMock = vi.hoisted(() => ({ notify: vi.fn(), notifyError: vi.fn() }));
const patchAnimeListStatus = vi.hoisted(() => vi.fn());

vi.mock('../../api/client', () => ({ listApi, animeApi: {}, authApi: {}, activityApi: {}, reviewApi: {} }));
vi.mock('../../api/queries/anime', () => ({
    animeKeys: { all: ['anime'], bySlug: (slug) => ['anime', slug] },
    patchAnimeListStatus,
}));
vi.mock('../../components/ui/toast', () => toastMock);
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
    toastMock.notify.mockReset();
    toastMock.notifyError.mockReset();
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
        expect(toastMock.notifyError).toHaveBeenCalledWith('Too many episodes.', { id: 'list-7' });
        // The toast showed at once (optimistic); the error replaces it under the same id.
        expect(toastMock.notify).toHaveBeenCalledWith('Moved to Completed', expect.objectContaining({ id: 'list-7' }));
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

        // Already at 28 of 28: nothing to write.
        expect(listApi.update).not.toHaveBeenCalled();
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

        const [message, options] = toastMock.notify.mock.calls[0];
        expect(message).toBe('Removed from your list');
        await act(async () => { await options.onUndo(); });

        expect(listApi.add).toHaveBeenCalledWith({
            anime_id: 7, status: 'Completed', score: 8, episodes_watched: 28, notes: 'Great',
            started_at: '2026-01-01', finished_at: '2026-02-01', total_rewatches: 1,
        });
        expect(result.current.entry).toMatchObject({ id: 9, status: 'Completed' });
    });

    it('queues a second write behind the first instead of dropping it', async () => {
        const first = deferred();
        listApi.update
            .mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce({ data: { id: 3, status: 'Watching', episodes_watched: 6 } });
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 4 });

        let a;
        let b;
        act(() => { a = result.current.increment(); });
        act(() => { b = result.current.increment(); });
        // Both taps show at once; only the first request is out.
        expect(result.current.entry.episodes_watched).toBe(6);
        await act(async () => {});
        expect(listApi.update).toHaveBeenCalledTimes(1);

        await act(async () => {
            first.resolve({ data: { id: 3, status: 'Watching', episodes_watched: 5 } });
            await a;
            await b;
        });

        expect(listApi.update).toHaveBeenNthCalledWith(1, 3, { episodes_watched: 5 });
        expect(listApi.update).toHaveBeenNthCalledWith(2, 3, { episodes_watched: 6 });
        expect(result.current.entry.episodes_watched).toBe(6);
        expect(result.current.isPending).toBe(false);
    });

    it('a score picked right after an add waits for the new id (no lost score)', async () => {
        const added = deferred();
        listApi.add.mockReturnValueOnce(added.promise);
        listApi.update.mockResolvedValueOnce({ data: { id: 50, status: 'Completed', episodes_watched: 28, score: 8 } });
        const { result } = setup(null);

        let status;
        let score;
        act(() => { status = result.current.setStatus('Completed'); });
        act(() => { score = result.current.setScore(8); });
        expect(result.current.entry).toMatchObject({ status: 'Completed', score: 8 });

        await act(async () => {
            added.resolve({ data: { id: 50, status: 'Completed', episodes_watched: 28, score: 0 } });
            await status;
            await score;
        });

        expect(listApi.update).toHaveBeenCalledWith(50, { score: 8 });
        expect(result.current.entry).toMatchObject({ id: 50, status: 'Completed', score: 8 });
    });

    it('starts a rewatch through the server', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Watching', episodes_watched: 0, is_rewatching: true } });
        const { result } = setup({ id: 3, status: 'Completed', episodes_watched: 28 });

        await act(() => result.current.startRewatch());

        expect(listApi.update).toHaveBeenCalledWith(3, { is_rewatching: true });
        expect(result.current.entry).toMatchObject({ status: 'Watching', is_rewatching: true });
    });
});

describe('toast with Undo after every write (T6)', () => {
    it('says what changed and undoes a fresh add by removing it', async () => {
        listApi.add.mockResolvedValue({ data: { id: 41, status: 'Watching', episodes_watched: 0 } });
        listApi.remove.mockResolvedValue({});
        const { result } = setup(null);

        await act(() => result.current.setStatus('Watching'));

        expect(toastMock.notify).toHaveBeenCalledTimes(1);
        const [message, options] = toastMock.notify.mock.calls[0];
        expect(message).toBe('Added to Watching');
        expect(options.id).toBe('list-7');

        await act(async () => { await options.onUndo(); });

        expect(listApi.remove).toHaveBeenCalledWith(41);
        expect(result.current.entry).toMatchObject({ id: null, status: null });
        // The undo itself is silent: no second toast.
        expect(toastMock.notify).toHaveBeenCalledTimes(1);
    });

    it('undoes a status change by restoring every field the server moved', async () => {
        listApi.update
            .mockResolvedValueOnce({ data: { id: 3, status: 'Completed', episodes_watched: 28, finished_at: '2026-11-16', score: 0 } })
            .mockResolvedValueOnce({ data: { id: 3, status: 'Watching', episodes_watched: 12, finished_at: null, score: 0 } });
        const { result } = setup({ id: 3, status: 'Watching', episodes_watched: 12, started_at: '2026-11-01' });

        await act(() => result.current.setStatus('Completed'));
        expect(toastMock.notify.mock.calls[0][0]).toBe('Moved to Completed');
        // Once the server filled the progress, the toast says so.
        const [message, options] = toastMock.notify.mock.calls.at(-1);
        expect(message).toBe('Completed. All 28 episodes marked watched');

        await act(async () => { await options.onUndo(); });

        expect(listApi.update).toHaveBeenLastCalledWith(3, {
            status: 'Watching', score: 0, episodes_watched: 12, started_at: '2026-11-01',
            finished_at: null, is_rewatching: false, total_rewatches: 0,
        });
        expect(result.current.entry).toMatchObject({ status: 'Watching', episodes_watched: 12 });
    });

    it('scores through setScore, clamped to 0–10', async () => {
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Completed', score: 10 } });
        const { result } = setup({ id: 3, status: 'Completed', score: 0 });

        await act(() => result.current.setScore(14));

        expect(listApi.update).toHaveBeenCalledWith(3, { score: 10 });
        expect(toastMock.notify.mock.calls[0][0]).toBe('Scored 10');
    });

    it('describes progress, score and status changes in words', () => {
        const base = { id: 3, status: 'Watching', episodes_watched: 12, score: 0 };
        expect(describeListChange(base, { ...base, episodes_watched: 13 })).toBe('Episode 13 watched');
        expect(describeListChange(base, { ...base, episodes_watched: 20 })).toBe('Progress set to 20');
        expect(describeListChange(base, { ...base, score: 9 })).toBe('Scored 9');
        expect(describeListChange(base, { ...base, status: 'Plan to Watch' })).toBe('Moved to Planning');
        expect(describeListChange({ id: null, status: null }, { ...base, status: 'On Hold' })).toBe('Added to On hold');
        // Adding straight to Completed says where progress landed too.
        expect(describeListChange({ id: null, status: null }, { ...base, status: 'Completed', episodes_watched: 5 }, 12)).toBe('Completed. Caught up to episode 5');
        // A show still airing completes up to the aired episode, and the toast says so.
        expect(describeListChange(base, { ...base, status: 'Completed', episodes_watched: 16 }, 24)).toBe('Completed. Caught up to episode 16');
        expect(describeListChange(base, { ...base, status: 'Completed', episodes_watched: 24 }, 24)).toBe('Completed. All 24 episodes marked watched');
    });
});

describe('listErrorMessage', () => {
    it('reads detail, then the first field error, then falls back', () => {
        expect(listErrorMessage({ response: { data: { detail: 'Nope' } } })).toBe('Nope');
        expect(listErrorMessage({ response: { data: { notes: ['Too long'] } } })).toBe('Too long');
        expect(listErrorMessage(new Error('offline'))).toBe('Could not update your list.');
    });
});
