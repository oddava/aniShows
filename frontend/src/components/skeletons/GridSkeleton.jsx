import React from 'react';
import { CardSkeleton } from '../ui/Skeleton';

/** The Browse grid's columns and gaps, so cards land exactly where the skeletons were. */
export const BROWSE_GRID_CLASSES = 'grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 anime-card-grid-gap';

export function GridSkeleton({ count = 12 }) {
    return (
        <div className={BROWSE_GRID_CLASSES}>
            {Array.from({ length: count }).map((_, i) => (
                <CardSkeleton key={i} />
            ))}
        </div>
    );
}

/** Compact grid skeleton for overlay/loading states. */
export function GridSkeletonCompact({ count = 6 }) {
    return (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {Array.from({ length: count }).map((_, i) => (
                <CardSkeleton key={i} meta={false} />
            ))}
        </div>
    );
}

export default GridSkeleton;
