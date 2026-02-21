import { useEffect, useRef, useCallback } from 'react';

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

    // Store the previously focused element when trap activates
    useEffect(() => {
        if (isActive) {
            previousActiveElement.current = document.activeElement;
        }
    }, [isActive]);

    // Restore focus when trap deactivates
    useEffect(() => {
        return () => {
            if (previousActiveElement.current && 
                typeof previousActiveElement.current.focus === 'function') {
                previousActiveElement.current.focus();
            }
        };
    }, []);

    // Handle tab key navigation and escape
    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const container = containerRef.current;

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
            setTimeout(() => {
                focusableElements[0].focus();
            }, 50);
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isActive, onEscape]);

    return containerRef;
}

export default useFocusTrap;
