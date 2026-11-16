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

/**
 * The shared `useFocusTrap` plus a Tab handler that wraps between the first and
 * last *enabled* controls. The shared trap counts disabled buttons, so a dialog
 * whose last button is disabled (an empty grant form, a gated confirm) let Tab
 * walk out of it. Escape, initial focus and focus restore stay with the shared hook.
 */
export default function useAdminFocusTrap(isActive, onEscape) {
    const containerRef = useFocusTrap(isActive, onEscape);

    useEffect(() => {
        const container = containerRef.current;
        if (!isActive || !container) return undefined;

        const handleTab = (e) => {
            if (e.key !== 'Tab') return;
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
            if (e.shiftKey && (active === first || !container.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !container.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        };

        container.addEventListener('keydown', handleTab);
        return () => container.removeEventListener('keydown', handleTab);
    }, [isActive, containerRef]);

    return containerRef;
}
