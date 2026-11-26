import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Only what Tab can actually reach: disabled controls are skipped by the browser.
const TABBABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function tabbableIn(container) {
    return Array.from(container.querySelectorAll(TABBABLE)).filter(
        (element) => !element.closest('[inert]'),
    );
}

// Open traps, innermost last: a confirm dialog over a drawer owns Tab and Escape.
const openTraps = [];
const isTopmost = (container) => openTraps[openTraps.length - 1] === container;

// A menu opened from inside the surface is portalled to <body>, but it is part
// of the surface for focus purposes: it handles its own keys.
const inMenu = (element) => Boolean(element?.closest?.('[role="menu"]'));

/**
 * Keep keyboard focus inside a modal surface while `isActive`:
 * - focus moves into it when it appears (an `autoFocus` field keeps focus;
 *   otherwise the surface itself takes it, so no control shows a ring until
 *   the keyboard is used);
 * - Tab and Shift+Tab wrap between the first and last *enabled* controls, and
 *   pull focus back in if it fell outside;
 * - Escape calls `onEscape`, for the innermost trap only, and only when no
 *   control inside (an open menu) already handled it;
 * - focus returns to whatever opened it when it closes.
 *
 * Returns a callback ref, so a surface that mounts after `isActive` turns on
 * (portals, exit animations) is still trapped.
 */
export default function useAdminFocusTrap(isActive, onEscape) {
    const [container, setContainer] = useState(null);
    const onEscapeRef = useRef(onEscape);
    useEffect(() => {
        onEscapeRef.current = onEscape;
    }, [onEscape]);

    const ref = useCallback((node) => setContainer(node), []);

    // Who opened it, read while rendering the open state: before an autoFocus
    // field inside takes focus during the commit.
    const opener = useMemo(() => (isActive && typeof document !== 'undefined' ? document.activeElement : null), [isActive]);

    useEffect(() => {
        if (!isActive || !container) return undefined;
        const previous = opener;
        openTraps.push(container);
        let frame = null;

        const focusSurface = () => {
            if (container.contains(document.activeElement)) return;
            if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
            container.focus({ preventScroll: true });
        };
        focusSurface();
        // A surface that is still becoming visible (a sheet sliding in) cannot
        // take focus yet: try again on the next frame.
        if (!container.contains(document.activeElement)) frame = window.requestAnimationFrame(focusSurface);

        const onTab = (event) => {
            if (event.key !== 'Tab' || !isTopmost(container) || inMenu(event.target)) return;
            const tabbable = tabbableIn(container);
            if (tabbable.length === 0) {
                event.preventDefault();
                container.focus({ preventScroll: true });
                return;
            }
            const first = tabbable[0];
            const last = tabbable[tabbable.length - 1];
            const active = document.activeElement;
            const outside = !container.contains(active) || active === container;
            if (event.shiftKey && (active === first || outside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || outside)) {
                event.preventDefault();
                first.focus();
            }
        };

        const onEscapeKey = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented || !isTopmost(container)) return;
            if (!onEscapeRef.current) return;
            event.preventDefault();
            onEscapeRef.current();
        };

        document.addEventListener('keydown', onTab, true);
        document.addEventListener('keydown', onEscapeKey);
        return () => {
            if (frame !== null) window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', onTab, true);
            document.removeEventListener('keydown', onEscapeKey);
            const index = openTraps.lastIndexOf(container);
            if (index !== -1) openTraps.splice(index, 1);

            const active = document.activeElement;
            const focusLost = !active || active === document.body || !active.isConnected
                || container.contains(active) || inMenu(active);
            if (focusLost && previous && previous !== document.body && previous.isConnected && typeof previous.focus === 'function') {
                previous.focus({ preventScroll: true });
            }
        };
    }, [isActive, container]); // eslint-disable-line react-hooks/exhaustive-deps

    return ref;
}
