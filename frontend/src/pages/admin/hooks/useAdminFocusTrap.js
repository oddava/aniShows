import { useEffect } from 'react';

import { useFocusTrap } from '../../../hooks/useFocusTrap';

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

// Open traps, innermost last: a confirm dialog over the user drawer owns Tab.
const openTraps = [];

/**
 * The shared `useFocusTrap` plus a Tab handler that wraps between the first and
 * last *enabled* controls. The shared trap counts disabled buttons, so a dialog
 * whose last button is disabled (an empty grant form, a gated confirm) let Tab
 * walk out of it. Escape, initial focus and focus restore stay with the shared hook.
 *
 * The handler listens on `document` in the capture phase, so it also catches Tab
 * when focus has fallen outside the dialog (a click on a non-focusable area moves
 * focus to `body`) and pulls it back in. Only the innermost open trap acts.
 */
export default function useAdminFocusTrap(isActive, onEscape) {
    const containerRef = useFocusTrap(isActive, onEscape);

    useEffect(() => {
        const container = containerRef.current;
        if (!isActive || !container) return undefined;
        openTraps.push(container);

        const handleTab = (e) => {
            if (e.key !== 'Tab' || openTraps[openTraps.length - 1] !== container) return;
            // Handled here; the shared document listener would use its own list.
            e.stopPropagation();
            const tabbable = tabbableIn(container);
            if (tabbable.length === 0) {
                e.preventDefault();
                return;
            }
            const first = tabbable[0];
            const last = tabbable[tabbable.length - 1];
            const active = document.activeElement;
            const outside = !container.contains(active);
            if (e.shiftKey && (active === first || outside)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || outside)) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleTab, true);
        return () => {
            document.removeEventListener('keydown', handleTab, true);
            const index = openTraps.lastIndexOf(container);
            if (index !== -1) openTraps.splice(index, 1);
        };
    }, [isActive, containerRef]);

    return containerRef;
}
