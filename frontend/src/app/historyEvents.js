/*
 * Router navigations run as transitions: the address changes at once, but the
 * page on screen stays until the next one is ready. history.pushState and
 * replaceState are patched once to announce every address change, so UI that
 * should answer the click itself (the route progress bar, the active nav tab)
 * can follow the address instead of waiting for the next page to render.
 */
export const HISTORY_EVENT = 'anishows:history';

export function patchHistory() {
    if (typeof window === 'undefined') return;
    const { history } = window;
    if (history.__anishowsPatched) return;
    history.__anishowsPatched = true;
    ['pushState', 'replaceState'].forEach((method) => {
        const original = history[method];
        history[method] = function patched(...args) {
            const result = original.apply(this, args);
            window.dispatchEvent(new Event(HISTORY_EVENT));
            return result;
        };
    });
}
