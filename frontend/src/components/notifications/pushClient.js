import { notificationApi } from '../../api/modules/notifications';
import logger from '../../utils/logger';

/*
 * Web push for this browser: the permission prompt, the push subscription and
 * the server row that goes with it. Nothing here runs without a click except
 * syncOnLoad (which never prompts) and detachOnLogout.
 *
 * What this device opted into is remembered in localStorage as
 * `{endpoint, id, userId}`: the server row id lets Settings tell this device
 * apart from the user's other devices, and the user id stops one account's
 * opt-in being carried over to the next account that signs in here.
 */

export const SERVICE_WORKER_URL = '/service-worker.js';
export const PUSH_DEVICE_STORAGE_KEY = 'anishows.pushDevice';
export const DETACH_TIMEOUT_MS = 1500;
// Refresh this device's server row at most daily: it re-activates a row the backend
// dropped after repeated failures. A row the user removed is gone and stays gone.
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

const readStoredDevice = () => {
    try {
        const raw = window.localStorage.getItem(PUSH_DEVICE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.endpoint === 'string' ? parsed : null;
    } catch {
        return null;
    }
};

const writeStoredDevice = (device) => {
    try {
        window.localStorage.setItem(PUSH_DEVICE_STORAGE_KEY, JSON.stringify(device));
    } catch {
        // Private mode or storage blocked: push still works, we just can't tell devices apart.
    }
};

const clearStoredDevice = () => {
    try {
        window.localStorage.removeItem(PUSH_DEVICE_STORAGE_KEY);
    } catch {
        // Nothing to clear.
    }
};

/** The device this browser registered, or null. */
export const getStoredDevice = () => readStoredDevice();

const sameUser = (stored, userId) => (
    userId == null || stored?.userId == null || String(stored.userId) === String(userId)
);

const isIosDevice = () => {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS reports itself as a Mac.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
};

const isStandalone = () => {
    if (navigator.standalone === true) return true;
    try {
        return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches);
    } catch {
        return false;
    }
};

/**
 * What this browser can do: 'unsupported', 'ios-needs-install' (an iPhone or
 * iPad Safari tab: push needs the Home Screen app), 'denied', 'default' or
 * 'granted' (the notification permission).
 */
export function support() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';

    const hasPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!hasPush) {
        if (navigator.standalone === false || (isIosDevice() && !isStandalone())) return 'ios-needs-install';
        return 'unsupported';
    }

    const permission = window.Notification.permission;
    if (permission === 'denied') return 'denied';
    if (permission === 'granted') return 'granted';
    return 'default';
}

const BROWSERS = [
    [/Edg(e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser\//, 'Samsung Internet'],
    [/Firefox\/|FxiOS\//, 'Firefox'],
    [/Chrome\/|CriOS\//, 'Chrome'],
    [/Safari\//, 'Safari'],
];

const SYSTEMS = [
    [/Android/, 'Android'],
    [/iPhone|iPod/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/CrOS/, 'ChromeOS'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/Linux/, 'Linux'],
];

/** A short name for a browser, from its user agent: "Chrome on Android". */
export function deviceLabel(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
    const ua = userAgent || '';
    const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] || 'Browser';
    const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
    return system ? `${browser} on ${system}` : browser;
}

/** base64url (the VAPID public key) to the bytes `applicationServerKey` wants. */
export function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
        output[index] = raw.charCodeAt(index);
    }
    return output;
}

const sameKey = (buffer, bytes) => {
    if (!buffer) return true; // The browser doesn't say: assume it matches.
    const current = new Uint8Array(buffer);
    if (current.length !== bytes.length) return false;
    return current.every((value, index) => value === bytes[index]);
};

const getRegistration = async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        return (await navigator.serviceWorker.getRegistration('/')) || null;
    } catch {
        return null;
    }
};

const getSubscription = async (registration) => {
    if (!registration?.pushManager) return null;
    try {
        return (await registration.pushManager.getSubscription()) || null;
    } catch {
        return null;
    }
};

const registerWorker = async () => {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: '/',
        updateViaCache: 'none',
    });
    // pushManager.subscribe needs an active worker; don't wait forever if it never activates.
    let timer = null;
    const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), 10000);
        }),
    ]);
    clearTimeout(timer);
    return ready || registration;
};

const fetchPublicKey = async () => {
    const { data } = await notificationApi.getPushConfig();
    if (!data?.enabled || !data?.public_key) {
        const error = new Error('Push notifications are not available on this server.');
        error.code = 'push-disabled';
        throw error;
    }
    return data.public_key;
};

const postSubscription = async (subscription, userId, { refresh = false } = {}) => {
    const json = subscription.toJSON ? subscription.toJSON() : subscription;
    const { data } = await notificationApi.subscribe({
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        device_type: 'browser',
        device_info: { label: deviceLabel() },
        ...(refresh ? { refresh: true } : {}),
    });
    const device = {
        endpoint: json.endpoint,
        id: data?.id ?? null,
        userId: userId ?? null,
        syncedAt: Date.now(),
    };
    writeStoredDevice(device);
    return device;
};

const subscribeWith = async (registration, publicKey) => {
    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    const existing = await getSubscription(registration);
    if (existing) {
        if (sameKey(existing.options?.applicationServerKey, applicationServerKey)) return existing;
        // The server's key changed: the old subscription can't be used.
        try {
            await existing.unsubscribe();
        } catch {
            // Subscribe below replaces it anyway.
        }
    }
    return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
};

const pushError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};

/**
 * Turns push on for this browser. Call it from a click: it may show the
 * browser's permission prompt. Resolves to `{endpoint, id}`; rejects with an
 * Error whose `code` is 'unsupported', 'ios-needs-install', 'denied',
 * 'push-disabled' or undefined (network or browser failure).
 */
export async function enable({ publicKey, userId } = {}) {
    const state = support();
    if (state === 'unsupported' || state === 'ios-needs-install') {
        throw pushError(state, 'This browser can’t receive push notifications.');
    }
    if (state === 'denied') {
        throw pushError('denied', 'Notifications are blocked for this site.');
    }

    // Ask straight away, while the click still counts as a user gesture
    // (Safari drops the gesture after the first await).
    const permissionRequest = window.Notification.permission === 'granted'
        ? Promise.resolve('granted')
        : Promise.resolve(window.Notification.requestPermission());

    const registration = await registerWorker();
    const permission = await permissionRequest;
    if (permission !== 'granted') {
        throw pushError(permission === 'denied' ? 'denied' : 'dismissed', 'Notification permission was not given.');
    }

    const key = publicKey || await fetchPublicKey();
    const subscription = await subscribeWith(registration, key);
    const device = await postSubscription(subscription, userId);
    return { endpoint: device.endpoint, id: device.id };
}

/** Turns push off for this browser: unsubscribes and removes the server row. */
export async function disable() {
    const stored = readStoredDevice();
    const registration = await getRegistration();
    const subscription = await getSubscription(registration);
    const endpoint = subscription?.endpoint || stored?.endpoint;

    if (subscription) {
        try {
            await subscription.unsubscribe();
        } catch (error) {
            logger.warn('Push: could not unsubscribe this browser', error);
        }
    }
    clearStoredDevice();

    if (endpoint) {
        try {
            await notificationApi.unsubscribe(endpoint);
        } catch (error) {
            // Already gone on the server is fine.
            if (error?.response?.status !== 404) throw error;
        }
    }
}

/**
 * This browser's push state for Settings: `{support, subscribed, endpoint, id}`.
 * `subscribed` means this user opted in here and the subscription still exists.
 */
export async function getDeviceState(userId) {
    const state = support();
    if (state === 'unsupported' || state === 'ios-needs-install') {
        return { support: state, subscribed: false, endpoint: null, id: null };
    }
    const stored = readStoredDevice();
    const subscription = await getSubscription(await getRegistration());
    const subscribed = Boolean(
        subscription && stored && stored.endpoint === subscription.endpoint && sameUser(stored, userId)
    );
    return {
        support: state,
        subscribed,
        endpoint: subscribed ? subscription.endpoint : null,
        id: subscribed ? stored.id ?? null : null,
    };
}

/**
 * Keeps the server in step with this browser, without prompting. When this
 * user opted in here and the browser's subscription changed (it can rotate,
 * see `pushsubscriptionchange`) or was last posted over a day ago, it is
 * posted (re-activating a row the server dropped); when it disappeared
 * while permission is still granted, a fresh one is made. Never throws.
 */
export async function syncOnLoad({ userId } = {}) {
    try {
        if (support() !== 'granted') return null;
        const stored = readStoredDevice();
        if (!stored) return null;

        const registration = await getRegistration();
        const subscription = await getSubscription(registration);

        if (!sameUser(stored, userId)) {
            // Another account opted in here and its logout didn't detach: stop
            // its pushes from reaching this user.
            clearStoredDevice();
            if (subscription) await subscription.unsubscribe().catch(() => {});
            return null;
        }

        if (subscription) {
            if (subscription.endpoint === stored.endpoint && stored.id != null) {
                const fresh = Date.now() - (Number(stored.syncedAt) || 0) < SYNC_INTERVAL_MS;
                if (fresh) return stored;
                try {
                    return await postSubscription(subscription, userId ?? stored.userId, { refresh: true });
                } catch (error) {
                    if (error?.response?.status !== 404) throw error;
                    // Removed from another device: respect it; the user can turn push on again.
                    clearStoredDevice();
                    await subscription.unsubscribe().catch(() => {});
                    return null;
                }
            }
            return await postSubscription(subscription, userId ?? stored.userId);
        }

        if (!registration) {
            clearStoredDevice();
            return null;
        }
        const fresh = await subscribeWith(registration, await fetchPublicKey());
        return await postSubscription(fresh, userId ?? stored.userId);
    } catch (error) {
        logger.warn('Push: sync failed', error);
        return null;
    }
}

/**
 * Best-effort cleanup before logout: unsubscribes this browser and deletes its
 * server row, so the next person on this device doesn't get this account's
 * pushes. Always resolves, within `timeoutMs` (1.5 s), and never throws.
 */
export function detachOnLogout({ timeoutMs = DETACH_TIMEOUT_MS } = {}) {
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
    });

    const work = (async () => {
        const stored = readStoredDevice();
        clearStoredDevice();
        const subscription = await getSubscription(await getRegistration());
        const endpoint = subscription?.endpoint || stored?.endpoint;
        if (!endpoint) return;
        await Promise.allSettled([
            subscription ? subscription.unsubscribe() : null,
            notificationApi.unsubscribe(endpoint),
        ]);
    })().catch(() => {});

    return Promise.race([work, timeout]).then(() => {
        clearTimeout(timer);
    });
}
