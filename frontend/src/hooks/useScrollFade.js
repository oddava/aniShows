import { useEffect, useState } from 'react';

/**
 * Edge fades for a horizontal scroller, only where content is actually hidden.
 * Returns a callback ref; sets data-fade-start / data-fade-end on the element
 * (styled by .scroll-fade in index.css) from its scroll position and size, and
 * no fade at all when everything fits. A callback ref (not useRef) so it also
 * works for elements that mount later, e.g. after data loads.
 */
export default function useScrollFade() {
    const [el, setEl] = useState(null);

    useEffect(() => {
        if (!el) return undefined;

        const update = () => {
            const maxScroll = el.scrollWidth - el.clientWidth;
            el.toggleAttribute('data-fade-start', maxScroll > 1 && el.scrollLeft > 1);
            el.toggleAttribute('data-fade-end', maxScroll > 1 && el.scrollLeft < maxScroll - 1);
        };

        update();
        el.addEventListener('scroll', update, { passive: true });
        const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        resizeObserver?.observe(el);
        // Children change width as data loads (tab counts, chips).
        const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
        mutationObserver?.observe(el, { childList: true, subtree: true, characterData: true });

        return () => {
            el.removeEventListener('scroll', update);
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [el]);

    return setEl;
}
