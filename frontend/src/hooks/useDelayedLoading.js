import { useState, useEffect } from 'react';

/**
 * Hook to delay loading state to prevent flashing on fast loads.
 * 
 * The correct pattern (like AniList):
 * 1. User clicks link → keep showing cached/previous content
 * 2. Wait 500ms before showing ANY loading state
 * 3. If still loading after 500ms → show skeleton
 * 4. If loaded before 500ms → user never sees loading
 * 
 * @param {boolean} isLoading - Whether data is currently loading
 * @param {number} delay - Milliseconds to wait before showing loading (default: 500)
 * @returns {boolean} - Whether to show loading UI
 */
export const useDelayedLoading = (isLoading, delay = 500) => {
    const [showLoading, setShowLoading] = useState(false);

    useEffect(() => {
        let timeoutId;
        
        if (isLoading) {
            // Wait before showing loading state
            timeoutId = setTimeout(() => {
                setShowLoading(true);
            }, delay);
        } else {
            // Immediately hide loading when done
            setShowLoading(false);
        }
        
        return () => clearTimeout(timeoutId);
    }, [isLoading, delay]);

    return showLoading;
};

export default useDelayedLoading;
