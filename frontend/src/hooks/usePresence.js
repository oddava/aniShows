import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted for `exitMs` after `open` turns false, so it can
 * play its closing animation. Returns { mounted, closing }: render while
 * `mounted`, and mark the root `data-state="closing"` while `closing`.
 */
export default function usePresence(open, exitMs = 160) {
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            setClosing(false);
            return undefined;
        }
        if (!mounted) return undefined;
        const reduce = typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduce || exitMs <= 0) {
            setMounted(false);
            return undefined;
        }
        setClosing(true);
        const timer = setTimeout(() => {
            setMounted(false);
            setClosing(false);
        }, exitMs);
        return () => clearTimeout(timer);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    return { mounted: open || mounted, closing: !open && closing };
}
