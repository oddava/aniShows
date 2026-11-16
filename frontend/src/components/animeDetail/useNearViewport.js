import { useCallback, useState } from 'react';

const hasIntersectionObserver = () =>
    typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';

/**
 * Whether an element has come within `rootMargin` of the viewport, for
 * loading data only when its section is about to show. Returns a callback
 * ref and the flag. The flag latches for the current `resetKey` (e.g. the
 * page's slug) and resets when the key changes. Without IntersectionObserver
 * it is always true, so the data still loads.
 */
export default function useNearViewport({ rootMargin = '600px 0px', resetKey = null } = {}) {
    const supported = hasIntersectionObserver();
    const [nearKey, setNearKey] = useState(undefined);

    const ref = useCallback((node) => {
        if (!node || !supported) return undefined;

        const observer = new window.IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setNearKey(resetKey);
                observer.disconnect();
            }
        }, { rootMargin });
        observer.observe(node);
        return () => observer.disconnect();
    }, [resetKey, rootMargin, supported]);

    return [ref, !supported || nearKey === resetKey];
}
