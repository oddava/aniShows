import React from 'react';

/**
 * Minimal card skeleton - smaller, denser layout
 */
export function MinimalCardSkeleton({ delay = 0 }) {
    return (
        <div 
            className="block aspect-[2/3] rounded-lg overflow-hidden relative skeleton-fade-in"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Shimmer overlay */}
            <div className="absolute inset-0 z-10 pointer-events-none shimmer-gradient" />
            
            {/* Full card shimmer */}
            <div className="w-full h-full bg-dark-200 relative overflow-hidden">
                <div className="absolute inset-0 skeleton-wave" />
            </div>
        </div>
    );
}

/**
 * Minimal skeleton layout for browse page minimal view
 * Higher density grid with smaller cards
 */
export function MinimalSkeleton({ count = 20 }) {
    return (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
            {Array.from({ length: count }).map((_, i) => (
                <MinimalCardSkeleton key={i} delay={i * 25} />
            ))}
        </div>
    );
}

export default MinimalSkeleton;
