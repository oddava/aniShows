import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * `value`, settled: it updates only after `value` has stopped changing for
 * `delay` ms. Admin search inputs use it so typing sends one request, not one
 * per keystroke.
 */
export default function useDebouncedValue(value, delay = SEARCH_DEBOUNCE_MS) {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(timer);
    }, [value, delay]);

    return debounced;
}
