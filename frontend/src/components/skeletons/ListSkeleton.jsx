import React from 'react';

/**
 * Individual list row skeleton component
 */
export function ListRowSkeleton({ delay = 0 }) {
    return (
        <div 
            className="flex items-center gap-4 p-4 bg-dark-100/50 rounded-xl skeleton-fade-in relative overflow-hidden"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Shimmer overlay */}
            <div className="absolute inset-0 z-10 pointer-events-none shimmer-gradient" />
            
            {/* Thumbnail placeholder - 64x96 (w-16 h-24) */}
            <div className="w-16 h-24 rounded-lg flex-shrink-0 bg-dark-200 relative overflow-hidden">
                <div className="absolute inset-0 skeleton-wave" />
            </div>
            
            {/* Content area */}
            <div className="flex-1 space-y-2.5 min-w-0">
                {/* Title line - 75% width */}
                <div className="h-4 bg-dark-200 rounded w-3/4 relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>                
                {/* Meta info line - 50% width */}
                <div className="h-3 bg-dark-200 rounded w-1/2 relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>                
                {/* Genres line - 33% width */}
                <div className="h-3 bg-dark-200 rounded w-1/3 relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>
            </div>
            
            {/* Rating placeholder - right side */}
            <div className="flex-shrink-0 flex flex-col items-end gap-2">
                <div className="flex items-center gap-1">
                    <div className="w-4 h-4 bg-dark-200 rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                    <div className="h-3.5 w-8 bg-dark-200 rounded relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * List skeleton layout for browse page list view
 */
export function ListSkeleton({ count = 8 }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }).map((_, i) => (
                <ListRowSkeleton key={i} delay={i * 60} />
            ))}
        </div>
    );
}

export default ListSkeleton;
