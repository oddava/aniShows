import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (false where matchMedia is unavailable). */
export default function useMediaQuery(query) {
    return useSyncExternalStore(
        (onChange) => {
            const mql = window.matchMedia?.(query);
            if (!mql) return () => {};
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        },
        () => Boolean(window.matchMedia?.(query).matches),
        () => false,
    );
}
