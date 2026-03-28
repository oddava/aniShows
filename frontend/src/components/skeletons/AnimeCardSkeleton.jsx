import React from 'react';

/**
 * Enhanced Anime Card Skeleton with wave shimmer animation
 * Matches the structure of the actual AnimeCard component
 */
export function AnimeCardSkeleton({ delay = 0, className = '' }) {
    return (
        <div
            className={`relative flex flex-col h-full skeleton-fade-in ${className}`}
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Card image placeholder - aspect ratio 2:3 */}
            <div className="aspect-[2/3] bg-dark-200 rounded-lg relative overflow-hidden text-gray-800">
                <div className="absolute inset-0 skeleton-wave" />
            </div>

            {/* Card content placeholder */}
            <div className="mt-3 space-y-2 block">
                {/* Title line - 85% width */}
                <div className="h-3 bg-dark-200 rounded w-[85%] relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>

                {/* Title line 2 - 60% width */}
                <div className="h-3 bg-dark-200 rounded w-[60%] relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>
            </div>
        </div>
    );
}

/**
 * Compact skeleton variant for when space is limited
 */
export function AnimeCardSkeletonCompact({ delay = 0 }) {
    return (
        <div
            className="relative overflow-hidden rounded-lg bg-dark-200 skeleton-fade-in"
            style={{ animationDelay: `${delay}ms` }}
        >
            <div className="absolute inset-0 z-20 pointer-events-none shimmer-gradient" />

            {/* Just image, no text for compact view */}
            <div className="aspect-[2/3] bg-dark-200 relative overflow-hidden">
                <div className="absolute inset-0 skeleton-wave" />
            </div>
        </div>
    );
}
export default AnimeCardSkeleton;
