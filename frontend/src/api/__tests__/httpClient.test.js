import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, {
    AUTH_EXPIRED_EVENT,
    SESSION_HINT_KEY,
    clearSession,
    getAccessToken,
    hasSession,
    refreshAccessToken,
    setAccessToken,
} from '../httpClient';

const ok = (config, data) => Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });

const fail = (config, status) => {
    const response = { data: {}, status, statusText: '', headers: {}, config };
    return Promise.reject(new axios.AxiosError(`HTTP ${status}`, String(status), config, null, response));
};

// A token whose exp is far away, so the proactive refresh stays quiet.
const fakeJwt = (exp = Math.floor(Date.now() / 1000) + 3600) =>
    `x.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.y`;

describe('httpClient auth', () => {
    let refreshAdapter;
    let apiAdapter;
    const originalRefreshAdapter = axios.defaults.adapter;
    const originalApiAdapter = api.defaults.adapter;

    beforeEach(() => {
        clearSession();
        refreshAdapter = vi.fn();
        apiAdapter = vi.fn();
        axios.defaults.adapter = refreshAdapter;
        api.defaults.adapter = apiAdapter;
    });

    afterEach(() => {
        axios.defaults.adapter = originalRefreshAdapter;
        api.defaults.adapter = originalApiAdapter;
        vi.useRealTimers();
    });

    it('never persists the access token', () => {
        setAccessToken('in-memory');

        expect(getAccessToken()).toBe('in-memory');
        expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
        expect(JSON.stringify({ ...localStorage })).not.toContain('in-memory');
    });

    it('skips the refresh request when there is no session', async () => {
        const onExpired = vi.fn();
        window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);

        await expect(refreshAccessToken()).rejects.toThrow('No session');

        expect(refreshAdapter).not.toHaveBeenCalled();
        expect(onExpired).not.toHaveBeenCalled();
        window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    });

    it('refreshes from the cookie with the CSRF header and shares one request', async () => {
        localStorage.setItem(SESSION_HINT_KEY, '1');
        refreshAdapter.mockImplementation((config) => ok(config, { access: 'new-access' }));

        const [first, second] = await Promise.all([refreshAccessToken(), refreshAccessToken()]);

        expect(first).toBe('new-access');
        expect(second).toBe('new-access');
        expect(refreshAdapter).toHaveBeenCalledTimes(1);
        const config = refreshAdapter.mock.calls[0][0];
        expect(config.url).toBe('/api/v1/auth/refresh/');
        expect(config.withCredentials).toBe(true);
        expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
        expect(config.data).toBeFalsy();
        expect(getAccessToken()).toBe('new-access');
    });

    it('signs out on a 401 from refresh without retrying', async () => {
        localStorage.setItem(SESSION_HINT_KEY, '1');
        const onExpired = vi.fn();
        window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
        refreshAdapter.mockImplementation((config) => fail(config, 401));

        await expect(refreshAccessToken()).rejects.toMatchObject({ response: { status: 401 } });

        expect(refreshAdapter).toHaveBeenCalledTimes(1);
        expect(hasSession()).toBe(false);
        expect(onExpired).toHaveBeenCalledTimes(1);
        window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    });

    it('retries server errors and keeps the session', async () => {
        vi.useFakeTimers();
        localStorage.setItem(SESSION_HINT_KEY, '1');
        refreshAdapter
            .mockImplementationOnce((config) => fail(config, 502))
            .mockImplementationOnce((config) => ok(config, { access: 'after-retry' }));

        const pending = refreshAccessToken();
        await vi.advanceTimersByTimeAsync(1000);

        await expect(pending).resolves.toBe('after-retry');
        expect(refreshAdapter).toHaveBeenCalledTimes(2);
        expect(hasSession()).toBe(true);
    });

    it('lets a new refresh start after the previous one failed', async () => {
        localStorage.setItem(SESSION_HINT_KEY, '1');
        refreshAdapter.mockImplementationOnce((config) => fail(config, 400));
        await expect(refreshAccessToken()).rejects.toBeTruthy();

        localStorage.setItem(SESSION_HINT_KEY, '1');
        refreshAdapter.mockImplementationOnce((config) => ok(config, { access: 'second' }));
        await expect(refreshAccessToken()).resolves.toBe('second');
    });

    it('refreshes once on parallel 401s and replays both requests', async () => {
        setAccessToken(fakeJwt());
        refreshAdapter.mockImplementation((config) => ok(config, { access: 'fresh' }));
        apiAdapter.mockImplementation((config) =>
            config.headers.Authorization === 'Bearer fresh' ? ok(config, { url: config.url }) : fail(config, 401),
        );

        const [a, b] = await Promise.all([api.get('/a/'), api.get('/b/')]);

        expect(a.data.url).toBe('/a/');
        expect(b.data.url).toBe('/b/');
        expect(refreshAdapter).toHaveBeenCalledTimes(1);
    });

    it('does not try to refresh for anonymous 401s', async () => {
        apiAdapter.mockImplementation((config) => fail(config, 401));

        await expect(api.get('/users/me/')).rejects.toMatchObject({ response: { status: 401 } });
        expect(refreshAdapter).not.toHaveBeenCalled();
    });
});

describe('legacy token cleanup', () => {
    it('removes tokens persisted by older builds on load', async () => {
        localStorage.setItem('access_token', 'old-access');
        localStorage.setItem('refresh_token', 'old-refresh');
        vi.resetModules();

        await import('../httpClient');

        expect(localStorage.getItem('access_token')).toBeNull();
        expect(localStorage.getItem('refresh_token')).toBeNull();
    });
});
