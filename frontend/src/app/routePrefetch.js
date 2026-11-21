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

const COMMON = ['/', '/browse', '/anime/x', '/list', '/schedule', '/u/x'];

/** Prefetch the common pages once the browser is idle (not on data saver or 2G). */
export function prefetchCommonRoutes() {
    if (typeof window === 'undefined') return;
    const connection = navigator.connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType || '')) return;
    const run = () => COMMON.forEach(prefetchRoute);
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
    else window.setTimeout(run, 2500);
}

/** Internal links prefetch their page on hover, focus or touch. */
export function installLinkPrefetch() {
    if (typeof document === 'undefined') return () => {};
    const onIntent = (event) => {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor || anchor.target === '_blank') return;
        let url;
        try {
            url = new URL(anchor.href, window.location.href);
        } catch {
            return;
        }
        if (url.origin !== window.location.origin) return;
        prefetchRoute(url.pathname);
    };
    const options = { passive: true, capture: true };
    document.addEventListener('pointerover', onIntent, options);
    document.addEventListener('focusin', onIntent, options);
    document.addEventListener('touchstart', onIntent, options);
    return () => {
        document.removeEventListener('pointerover', onIntent, options);
        document.removeEventListener('focusin', onIntent, options);
        document.removeEventListener('touchstart', onIntent, options);
    };
}
