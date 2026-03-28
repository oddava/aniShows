import React from 'react';
import { AnimeCardSkeleton } from './AnimeCardSkeleton';

/**
 * Grid skeleton layout for browse page grid view
 * Dynamically adjusts columns based on screen size like the real grid
 */
export function GridSkeleton({ count = 12, compact = false }) {
    // Calculate stagger delay - faster for compact mode, and overall faster for smoother feel
    const getDelay = (index) => compact ? index * 20 : index * 35;

    return (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5 md:gap-6">
            {Array.from({ length: count }).map((_, i) => (
                <AnimeCardSkeleton
                    key={i}
                    delay={getDelay(i)}
                />
            ))}
        </div>
    );
}

/**
 * Compact grid skeleton for overlay/loading states
 */
export function GridSkeletonCompact({ count = 6 }) {
    return (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 opacity-70">
            {Array.from({ length: count }).map((_, i) => (
                <AnimeCardSkeleton
                    key={i}
                    delay={i * 30}
                    className="scale-95"
                />
            ))}
        </div>
    );
}

export default GridSkeleton;
