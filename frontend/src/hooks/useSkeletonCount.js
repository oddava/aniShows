import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to calculate optimal skeleton count based on viewport and view mode
 * @param {string} viewMode - 'grid', 'list', or 'minimal'
 * @param {Object} options - Configuration options
 * @returns {number} - Optimal skeleton count
 */
export function useSkeletonCount(viewMode = 'grid', options = {}) {
    const {
        headerOffset = 320,  // Space for header, search, tabs
        buffer = 2,          // Extra skeletons for buffer
        minCount = 6,        // Minimum skeletons to show
        maxCount = 48,       // Maximum skeletons to prevent overload
    } = options;

    const [count, setCount] = useState(minCount);

    const getColumnCount = useCallback(() => {
        if (typeof window === 'undefined') return 4;
        const width = window.innerWidth;

        // Match Tailwind breakpoints from Browse.jsx grid classes
        if (width < 480) return 2;      // xs:grid-cols-2 (though xs is min-width)
        if (width < 640) return 3;      // xs breakpoint
        if (width < 768) return 3;      // sm
        if (width < 1024) return 4;     // md
        if (width < 1280) return 6;     // lg
        return 7;                        // xl
    }, []);

    const calculateCount = useCallback(() => {
        if (typeof window === 'undefined') return minCount;

        const viewportHeight = window.innerHeight;
        const availableHeight = viewportHeight - headerOffset;

        let calculated = minCount;

        switch (viewMode) {
            case 'grid': {
                // Card height: 280px (aspect-[2/3] + title area) + gap: 20px
                const cardHeight = 300;
                const columns = getColumnCount();
                const rows = Math.ceil(availableHeight / cardHeight);
                calculated = rows * columns + buffer;
                break;
            }
            case 'list': {
                // Row height: ~100px + gap
                const rowHeight = 108;
                calculated = Math.ceil(availableHeight / rowHeight) + buffer;
                break;
            }
            case 'minimal': {
                // Smaller cards: 200px + gap
                const cardHeight = 220;
                const columns = Math.min(getColumnCount() * 2, 10); // More columns for minimal
                const rows = Math.ceil(availableHeight / cardHeight);
                calculated = rows * columns + buffer;
                break;
            }
            default:
                calculated = minCount;
        }

        // Clamp between min and max
        return Math.max(minCount, Math.min(calculated, maxCount));
    }, [viewMode, headerOffset, buffer, minCount, maxCount, getColumnCount]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // Initial calculation
        setCount(calculateCount());

        // Debounced resize handler
        let resizeTimer;
        const handleResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                setCount(calculateCount());
            }, 150); // Debounce to avoid excessive re-renders
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(resizeTimer);
        };
    }, [calculateCount]);

    // Recalculate when viewMode changes
    useEffect(() => {
        setCount(calculateCount());
    }, [viewMode, calculateCount]);

    return count;
}

export default useSkeletonCount;
