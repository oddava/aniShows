import { useLayoutEffect, useRef, useState } from 'react';

const ACTIVE = '[aria-current="page"], [aria-selected="true"], [aria-pressed="true"], [data-active="true"]';
const WATCHED = ['aria-current', 'aria-selected', 'aria-pressed', 'data-active'];

/**
 * One soft fill that glides to the current item of a group (tabs, nav,
 * segments) instead of the fill jumping between items.
 *
 * Give the host `className="pill-host"` and `ref={hostRef}` (a callback ref), and render
 * `<span ref={pillRef} className="active-pill" aria-hidden="true" />` as its
 * first child. The current item is found by its ARIA state (aria-current,
 * aria-selected, aria-pressed) or `data-active="true"`; `selector` narrows it
 * to a part of that item (the phone tab bar puts the pill behind the icon).
 *
 * The pill is placed with transform/width only, follows resizes and state
 * changes without a re-render of its own, and starts animating only after it
 * has been placed once, so it never flies in from the corner.
 */
export default function useActivePill(selector = ACTIVE) {
    // A callback ref: the host may mount after this hook first runs (a page
    // that shows its tabs once its data is in).
    const [host, setHost] = useState(null);
    const pillRef = useRef(null);

    useLayoutEffect(() => {
        const pill = pillRef.current;
        if (!host || !pill) return undefined;

        let frame = 0;
        let placed = false;
        let animateFrame = 0;

        const place = () => {
            frame = 0;
            const active = host.querySelector(selector);
            if (!active) {
                pill.style.opacity = '0';
                return;
            }
            // Layout offsets, not client rects: a transform on the item (a
            // press, an icon pop) must not bend the pill.
            const width = active.offsetWidth;
            const height = active.offsetHeight;
            if (!width || !height) return;
            let x = 0;
            let y = 0;
            let node = active;
            while (node && node !== host) {
                x += node.offsetLeft;
                y += node.offsetTop;
                node = node.offsetParent;
            }
            if (node !== host) {
                const h = host.getBoundingClientRect();
                const a = active.getBoundingClientRect();
                x = a.left - h.left + host.scrollLeft - host.clientLeft;
                y = a.top - h.top + host.scrollTop - host.clientTop;
            }
            pill.style.width = `${width}px`;
            pill.style.height = `${height}px`;
            pill.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            pill.style.opacity = '1';
            if (!placed) {
                placed = true;
                host.setAttribute('data-pill-ready', '');
                // Two frames: the first placement paints without a transition.
                animateFrame = requestAnimationFrame(() => {
                    animateFrame = requestAnimationFrame(() => host.setAttribute('data-pill-animate', ''));
                });
            }
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(place);
        };

        place();

        const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
        if (resize) {
            resize.observe(host);
            Array.from(host.children).forEach((child) => resize.observe(child));
        }
        const mutation = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
        mutation?.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED });
        document.fonts?.ready?.then(schedule).catch(() => {});

        return () => {
            cancelAnimationFrame(frame);
            cancelAnimationFrame(animateFrame);
            resize?.disconnect();
            mutation?.disconnect();
            host.removeAttribute('data-pill-ready');
            host.removeAttribute('data-pill-animate');
        };
    }, [host, selector]);

    return { hostRef: setHost, pillRef };
}
