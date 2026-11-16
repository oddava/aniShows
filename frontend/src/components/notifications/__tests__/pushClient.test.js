import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DETACH_TIMEOUT_MS,
    PUSH_DEVICE_STORAGE_KEY,
    detachOnLogout,
    deviceLabel,
    disable,
    enable,
    getDeviceState,
    support,
    syncOnLoad,
} from '../pushClient';

const api = vi.hoisted(() => ({
    getPushConfig: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
}));

vi.mock('../../../api/modules/notifications', () => ({ notificationApi: api }));
vi.mock('../../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

const defined = [];
const define = (target, key, value) => {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
    defined.push(() => {
        if (had) Object.defineProperty(target, key, previous);
        else delete target[key];
    });
};

const fakeSubscription = (endpoint) => ({
    endpoint,
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint, keys: { p256dh: `p256-${endpoint}`, auth: `auth-${endpoint}` } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
});

/** A browser that can do push; `subscription` is what getSubscription returns. */
const installPushBrowser = ({ permission = 'default', subscription = null, userAgent = CHROME_ANDROID } = {}) => {
    const registration = {
        pushManager: {
            getSubscription: vi.fn().mockResolvedValue(subscription),
            subscribe: vi.fn().mockResolvedValue(fakeSubscription('https://push.example/new')),
        },
    };
    const container = {
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
        getRegistration: vi.fn().mockResolvedValue(registration),
    };
    const NotificationMock = { permission, requestPermission: vi.fn().mockResolvedValue('granted') };
    define(navigator, 'serviceWorker', container);
    define(navigator, 'userAgent', userAgent);
    define(window, 'PushManager', function PushManager() {});
    define(window, 'Notification', NotificationMock);
    return { registration, container, NotificationMock };
};

const store = (device) => window.localStorage.setItem(PUSH_DEVICE_STORAGE_KEY, JSON.stringify(device));
const stored = () => JSON.parse(window.localStorage.getItem(PUSH_DEVICE_STORAGE_KEY) || 'null');

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    window.localStorage.clear();
});

afterEach(() => {
    while (defined.length) defined.pop()();
    vi.useRealTimers();
});

describe('support()', () => {
    it('is unsupported without service workers or PushManager', () => {
        define(navigator, 'userAgent', FIREFOX_WINDOWS);
        define(window, 'PushManager', undefined);
        delete window.PushManager;
        expect(support()).toBe('unsupported');
    });

    it('asks iPhone Safari tabs to install the app first', () => {
        define(navigator, 'userAgent', IPHONE_SAFARI);
        define(navigator, 'standalone', false);
        expect('PushManager' in window).toBe(false);
        expect(support()).toBe('ios-needs-install');
    });

    it('reports the notification permission', () => {
        const { NotificationMock } = installPushBrowser({ permission: 'denied' });
        expect(support()).toBe('denied');
        NotificationMock.permission = 'default';
        expect(support()).toBe('default');
        NotificationMock.permission = 'granted';
        expect(support()).toBe('granted');
    });
});

describe('deviceLabel()', () => {
    it('names the browser and system', () => {
        expect(deviceLabel(CHROME_ANDROID)).toBe('Chrome on Android');
        expect(deviceLabel(IPHONE_SAFARI)).toBe('Safari on iPhone');
        expect(deviceLabel(FIREFOX_WINDOWS)).toBe('Firefox on Windows');
    });
});

describe('enable()', () => {
    it('registers the worker, asks once, subscribes and posts the subscription', async () => {
        const { registration, container, NotificationMock } = installPushBrowser();
        api.subscribe.mockResolvedValue({ data: { status: 'subscribed', id: 42 } });

        const result = await enable({ publicKey: 'BAEC', userId: 7 });

        expect(container.register).toHaveBeenCalledWith('/service-worker.js', { scope: '/', updateViaCache: 'none' });
        expect(NotificationMock.requestPermission).toHaveBeenCalledTimes(1);
        const options = registration.pushManager.subscribe.mock.calls[0][0];
        expect(options.userVisibleOnly).toBe(true);
        expect(Array.from(options.applicationServerKey)).toEqual([4, 1, 2]);
        expect(api.subscribe).toHaveBeenCalledWith({
            endpoint: 'https://push.example/new',
            p256dh: 'p256-https://push.example/new',
            auth: 'auth-https://push.example/new',
            device_type: 'browser',
            device_info: { label: 'Chrome on Android' },
        });
        expect(result).toEqual({ endpoint: 'https://push.example/new', id: 42 });
        expect(stored()).toMatchObject({ endpoint: 'https://push.example/new', id: 42, userId: 7 });
    });

    it('fetches the public key when it is not given, and refuses when push is off', async () => {
        installPushBrowser({ permission: 'granted' });
        api.getPushConfig.mockResolvedValue({ data: { enabled: false, public_key: '' } });

        await expect(enable()).rejects.toMatchObject({ code: 'push-disabled' });
        expect(api.subscribe).not.toHaveBeenCalled();
    });

    it('does not prompt when permission is denied', async () => {
        const { NotificationMock } = installPushBrowser({ permission: 'denied' });
        await expect(enable({ publicKey: 'BAEC' })).rejects.toMatchObject({ code: 'denied' });
        expect(NotificationMock.requestPermission).not.toHaveBeenCalled();
    });
});

describe('disable()', () => {
    it('unsubscribes and deletes the server row', async () => {
        const subscription = fakeSubscription('https://push.example/a');
        installPushBrowser({ permission: 'granted', subscription });
        store({ endpoint: 'https://push.example/a', id: 1, userId: 7 });
        api.unsubscribe.mockResolvedValue({ data: { status: 'unsubscribed' } });

        await disable();

        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(api.unsubscribe).toHaveBeenCalledWith('https://push.example/a');
        expect(stored()).toBeNull();
    });
});

describe('getDeviceState()', () => {
    it('counts as subscribed only for the user who opted in here', async () => {
        installPushBrowser({ permission: 'granted', subscription: fakeSubscription('https://push.example/a') });
        store({ endpoint: 'https://push.example/a', id: 3, userId: 7 });

        await expect(getDeviceState(7)).resolves.toMatchObject({ subscribed: true, id: 3 });
        await expect(getDeviceState(8)).resolves.toMatchObject({ subscribed: false, id: null });
    });
});

describe('syncOnLoad()', () => {
    it('re-posts when the browser subscription changed', async () => {
        installPushBrowser({ permission: 'granted', subscription: fakeSubscription('https://push.example/rotated') });
        store({ endpoint: 'https://push.example/old', id: 3, userId: 7 });
        api.subscribe.mockResolvedValue({ data: { id: 9 } });

        await syncOnLoad({ userId: 7 });

        expect(api.subscribe).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.example/rotated' }));
        expect(stored()).toMatchObject({ endpoint: 'https://push.example/rotated', id: 9, userId: 7 });
        expect(stored().syncedAt).toEqual(expect.any(Number));
    });

    it('re-posts an unchanged subscription once a day, so a dropped server row comes back', async () => {
        installPushBrowser({ permission: 'granted', subscription: fakeSubscription('https://push.example/a') });
        store({ endpoint: 'https://push.example/a', id: 3, userId: 7, syncedAt: Date.now() - 25 * 60 * 60 * 1000 });
        api.subscribe.mockResolvedValue({ data: { id: 3 } });

        await syncOnLoad({ userId: 7 });

        expect(api.subscribe).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.example/a' }));
    });

    it('does nothing when the endpoint is unchanged or permission is not granted', async () => {
        const { NotificationMock } = installPushBrowser({
            permission: 'granted',
            subscription: fakeSubscription('https://push.example/a'),
        });
        store({ endpoint: 'https://push.example/a', id: 3, userId: 7, syncedAt: Date.now() });

        await syncOnLoad({ userId: 7 });
        NotificationMock.permission = 'default';
        await syncOnLoad({ userId: 7 });

        expect(api.subscribe).not.toHaveBeenCalled();
    });

    it('never carries another account’s opt-in over', async () => {
        const subscription = fakeSubscription('https://push.example/a');
        installPushBrowser({ permission: 'granted', subscription });
        store({ endpoint: 'https://push.example/a', id: 3, userId: 7 });

        await syncOnLoad({ userId: 8 });

        expect(api.subscribe).not.toHaveBeenCalled();
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(stored()).toBeNull();
    });

    it('never throws', async () => {
        installPushBrowser({ permission: 'granted', subscription: fakeSubscription('https://push.example/new') });
        store({ endpoint: 'https://push.example/old', id: 3, userId: 7 });
        api.subscribe.mockRejectedValue(new Error('offline'));

        await expect(syncOnLoad({ userId: 7 })).resolves.toBeNull();
    });
});

describe('detachOnLogout()', () => {
    it('unsubscribes and deletes the row', async () => {
        const subscription = fakeSubscription('https://push.example/a');
        installPushBrowser({ permission: 'granted', subscription });
        store({ endpoint: 'https://push.example/a', id: 3, userId: 7 });
        api.unsubscribe.mockResolvedValue({});

        await detachOnLogout();

        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(api.unsubscribe).toHaveBeenCalledWith('https://push.example/a');
        expect(stored()).toBeNull();
    });

    it('resolves within the timeout even when the network hangs', async () => {
        vi.useFakeTimers();
        installPushBrowser({ permission: 'granted', subscription: fakeSubscription('https://push.example/a') });
        api.unsubscribe.mockReturnValue(new Promise(() => {}));

        let settled = false;
        const pending = detachOnLogout().then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(DETACH_TIMEOUT_MS - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(settled).toBe(true);
    });

    it('never throws, even without service-worker support', async () => {
        define(navigator, 'serviceWorker', {
            getRegistration: () => {
                throw new Error('boom');
            },
        });
        await expect(detachOnLogout()).resolves.toBeUndefined();
    });
});
