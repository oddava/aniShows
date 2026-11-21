import { useEffect, useRef } from 'react';

/**
 * Hook to trap focus within a container element
 * Useful for modals, drawers, and dialogs
 * 
 * @param {boolean} isActive - Whether the focus trap should be active
 * @param {Function} onEscape - Callback when Escape key is pressed
 * @returns {React.RefObject} - Ref to attach to the container element
 */
export function useFocusTrap(isActive, onEscape) {
    const containerRef = useRef(null);
    const previousActiveElement = useRef(null);

    // Remember what had focus when the trap turns on, and give focus back to it
    // when the trap turns off (dialog closed) or unmounts. Components that stay
    // mounted while closed (an exit animation, `return null`) need the former.
    useEffect(() => {
        if (!isActive) return undefined;
        const previous = document.activeElement;
        previousActiveElement.current = previous;
        const container = containerRef.current;
        return () => {
            const active = document.activeElement;
            // Leave focus alone if the user deliberately moved it elsewhere.
            const focusIsLost = !active
                || active === document.body
                || !active.isConnected
                || (container && container.contains(active));
            if (
                focusIsLost
                && previous
                && previous !== document.body
                && previous.isConnected
                && typeof previous.focus === 'function'
            ) {
                previous.focus({ preventScroll: true });
            }
        };
    }, [isActive]);

    // Handle tab key navigation and escape
    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const container = containerRef.current;
        let focusTimerId = null;

        const handleKeyDown = (e) => {
            // Handle Escape key
            if (e.key === 'Escape' && onEscape) {
                e.preventDefault();
                onEscape();
                return;
            }

            // Only handle Tab key
            if (e.key !== 'Tab') return;

            // Get all focusable elements
            const focusableElements = container.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            
            if (focusableElements.length === 0) return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            // If Shift+Tab on first element, wrap to last
            if (e.shiftKey && document.activeElement === firstElement) {
                e.preventDefault();
                lastElement.focus();
            }
            // If Tab on last element, wrap to first
            else if (!e.shiftKey && document.activeElement === lastElement) {
                e.preventDefault();
                firstElement.focus();
            }
        };

        // Focus the first focusable element when trap activates
        const focusableElements = container.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
            // Small delay to ensure DOM is ready
            focusTimerId = window.setTimeout(() => {
                if (!container.contains(document.activeElement)) {
                    focusableElements[0].focus();
                }
            }, 50);
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            if (focusTimerId !== null) {
                window.clearTimeout(focusTimerId);
            }
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isActive, onEscape]);

    return containerRef;
}

export default useFocusTrap;
