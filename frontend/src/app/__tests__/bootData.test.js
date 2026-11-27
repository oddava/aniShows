import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefetchQuery = vi.fn(() => Promise.resolve());
let signedIn = false;

vi.mock('../queryClient', () => ({ default: { prefetchQuery: (...args) => prefetchQuery(...args) } }));
vi.mock('../../api/httpClient', () => ({ hasSession: () => signedIn }));

const { startBootData } = await import('../bootData');

const keys = () => prefetchQuery.mock.calls.map(([options]) => options.queryKey);

describe('startBootData (LCP: the first page request starts at boot)', () => {
    beforeEach(() => {
        prefetchQuery.mockClear();
        signedIn = false;
    });

    it('starts an anime page payload', () => {
        startBootData('/anime/frieren/characters');
        expect(keys()).toEqual([['anime', 'frieren', 'anonymous']]);
    });

    it("starts Browse's rows, the unfiltered page's content", () => {
        startBootData('/browse/', '');
        expect(keys()).toEqual([['anime', 'browse-row', false]]);
    });

    it('leaves a filtered Browse to its own grid query', () => {
        startBootData('/browse', '?genre=Action');
        expect(prefetchQuery).not.toHaveBeenCalled();
    });

    it("starts the guest home's trending shelf", () => {
        startBootData('/');
        expect(keys()).toEqual([['anime', 'trending', 'guest-home']]);
    });

    it('does nothing for members (their copy depends on who they are)', () => {
        signedIn = true;
        startBootData('/browse');
        startBootData('/');
        startBootData('/anime/frieren');
        expect(prefetchQuery).not.toHaveBeenCalled();
    });
});
