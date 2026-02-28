import React from 'react';

/**
 * Enhanced Anime Card Skeleton with wave shimmer animation
 * Matches the structure of the actual AnimeCard component
 */
export function AnimeCardSkeleton({ delay = 0, className = '' }) {
    return (
        <div
            className={`relative overflow-hidden rounded-xl bg-dark-200 skeleton-fade-in ${className}`}
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Gradient shimmer overlay */}
            <div className="absolute inset-0 z-20 pointer-events-none shimmer-gradient" />

            {/* Card image placeholder - aspect ratio 2:3 */}
            <div className="aspect-[2/3] bg-dark-300 relative overflow-hidden text-gray-800">
                <div className="absolute inset-0 skeleton-wave" />
            </div>

            {/* Card content placeholder */}
            <div className="p-2.5 space-y-2">
                {/* Title line - 85% width */}
                <div className="h-3.5 bg-dark-300 rounded w-[85%] relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>

                {/* Subtitle line - 60% width */}
                <div className="h-2.5 bg-dark-300 rounded w-[60%] relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>

                {/* Rating line with star icon */}
                <div className="flex items-center gap-1.5 pt-0.5">
                    <div className="w-3.5 h-3.5 bg-dark-300 rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                    <div className="h-2.5 w-10 bg-dark-300 rounded relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
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
            className="relative overflow-hidden rounded-xl bg-dark-200 skeleton-fade-in"
            style={{ animationDelay: `${delay}ms` }}
        >
            <div className="absolute inset-0 z-20 pointer-events-none shimmer-gradient" />

            {/* Just image, no text for compact view */}
            <div className="aspect-[2/3] bg-dark-300 relative overflow-hidden">
                <div className="absolute inset-0 skeleton-wave" />
            </div>
        </div>
    );
}
export default AnimeCardSkeleton;
