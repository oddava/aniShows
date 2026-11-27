/*
 * Warm a page's code before it is needed: on idle after the first paint for
 * the pages people open most, and when a link to a page is hovered, focused or
 * touched. The importers are the same dynamic imports the route modules use,
 * so Vite resolves them to the same chunks and React.lazy finds them loaded.
 */
const importers = [
    [/^\/$/, () => import('../pages/Home')],
    [/^\/browse/, () => import('../pages/Browse')],
    [/^\/schedule/, () => import('../pages/Schedule')],
    [/^\/anime\//, () => import('../pages/AnimeDetail')],
    [/^\/character\//, () => import('../pages/CharacterDetail')],
    [/^\/staff\//, () => import('../pages/VoiceActorDetail')],
    [/^\/list/, () => import('../pages/Library')],
    [/^\/(u\/|profile)/, () => import('../pages/Profile')],
    [/^\/settings/, () => import('../pages/Settings')],
    [/^\/notifications$/, () => import('../pages/Notifications')],
    [/^\/import/, () => import('../pages/ImportPage')],
    [/^\/export/, () => import('../pages/ExportPage')],
    [/^\/forums/, () => import('./routes/community').then((module) => module.preloadForumChunks?.())],
    [/^\/(login|register)/, () => import('../pages/Auth')],
];

const started = new Set();

export function prefetchRoute(pathname) {
    if (!pathname) return;
    const match = importers.find(([pattern]) => pattern.test(pathname));
    if (!match || started.has(match[0])) return;
    started.add(match[0]);
    Promise.resolve()
        .then(match[1])
        .catch(() => started.delete(match[0]));
}

const COMMON = ['/', '/browse', '/anime/x', '/list', '/schedule', '/u/x', '/notifications'];

// After the page's own load, this much longer: the first page's images and
// API calls finish first. Idle time before that is mostly the page waiting on
// its API, and other pages' code fetched then competed with its LCP image
// (RA-002: ~180 KB of Home/Browse/Profile/Markdown chunks on a phone link).
const COMMON_PREFETCH_DELAY_MS = 3000;

/** Prefetch the common pages once the page has loaded and the browser is idle (not on data saver or 2G). */
export function prefetchCommonRoutes() {
    if (typeof window === 'undefined') return;
    const connection = navigator.connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType || '')) return;
    const run = () => COMMON.forEach(prefetchRoute);
    const whenIdle = () => {
        if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
        else run();
    };
    const afterLoad = () => window.setTimeout(whenIdle, COMMON_PREFETCH_DELAY_MS);
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
}

// Page data, not just page code: components/common/DataPrefetch.jsx registers
// a function that warms the query cache for a path (e.g. /anime/:slug).
let dataPrefetcher = null;

export function registerDataPrefetch(fn) {
    dataPrefetcher = fn;
    return () => {
        if (dataPrefetcher === fn) dataPrefetcher = null;
    };
}

// A pointer that rests on a link this long is aiming for it; a pointer that
// sweeps across a grid of posters is not, and starts no requests.
const HOVER_INTENT_MS = 70;
// A finger that stays put this long is pressing, not scrolling; a finger that
// moves first is scrolling, and starts no requests.
const TOUCH_INTENT_MS = 90;
const TOUCH_SLOP_PX = 8;

/**
 * Internal links prefetch their page code on hover, focus or touch, and
 * their data once the pointer rests on them (focus and touch: at once).
 */
export function installLinkPrefetch() {
    if (typeof document === 'undefined') return () => {};
    let intentTimer = null;
    let intentAnchor = null;
    let touch = null;

    const sameOriginPath = (anchor) => {
        if (!anchor || anchor.target === '_blank') return null;
        try {
            const url = new URL(anchor.href, window.location.href);
            return url.origin === window.location.origin ? url.pathname : null;
        } catch {
            return null;
        }
    };

    const onIntent = (event) => {
        const anchor = event.target?.closest?.('a[href]');
        const path = sameOriginPath(anchor);
        if (!path) return;
        prefetchRoute(path);
        if (!dataPrefetcher) return;
        if (event.type === 'touchstart') {
            const point = event.touches?.[0];
            clearTimeout(touch?.timer);
            touch = {
                x: point?.clientX ?? 0,
                y: point?.clientY ?? 0,
                timer: setTimeout(() => {
                    touch = null;
                    dataPrefetcher?.(path);
                }, TOUCH_INTENT_MS),
            };
            return;
        }
        if (event.type !== 'pointerover') {
            dataPrefetcher(path);
            return;
        }
        // Touch screens also fire pointerover on tap: the touch path decides.
        if (event.pointerType === 'touch') return;
        if (anchor === intentAnchor) return;
        clearTimeout(intentTimer);
        intentAnchor = anchor;
        intentTimer = setTimeout(() => {
            intentTimer = null;
            if (intentAnchor === anchor) dataPrefetcher?.(path);
        }, HOVER_INTENT_MS);
    };
    const onTouchMove = (event) => {
        if (!touch) return;
        const point = event.touches?.[0];
        if (!point) return;
        if (Math.abs(point.clientX - touch.x) > TOUCH_SLOP_PX || Math.abs(point.clientY - touch.y) > TOUCH_SLOP_PX) {
            clearTimeout(touch.timer);
            touch = null;
        }
    };
    const onLeave = (event) => {
        if (!intentAnchor) return;
        const to = event.relatedTarget;
        if (to && intentAnchor.contains(to)) return;
        if (event.target?.closest?.('a[href]') !== intentAnchor) return;
        clearTimeout(intentTimer);
        intentTimer = null;
        intentAnchor = null;
    };
    const options = { passive: true, capture: true };
    document.addEventListener('pointerover', onIntent, options);
    document.addEventListener('pointerout', onLeave, options);
    document.addEventListener('focusin', onIntent, options);
    document.addEventListener('touchstart', onIntent, options);
    document.addEventListener('touchmove', onTouchMove, options);
    return () => {
        clearTimeout(intentTimer);
        clearTimeout(touch?.timer);
        document.removeEventListener('touchmove', onTouchMove, options);
        document.removeEventListener('pointerover', onIntent, options);
        document.removeEventListener('pointerout', onLeave, options);
        document.removeEventListener('focusin', onIntent, options);
        document.removeEventListener('touchstart', onIntent, options);
    };
}
