import React from 'react';

/**
 * Schedule card skeleton component
 * Mimics the structure of ScheduleCard with episode badge, time overlay, and info
 */
export function ScheduleCardSkeleton({ delay = 0 }) {
    return (
        <div
            className="relative overflow-hidden rounded-xl bg-dark-100 skeleton-fade-in border border-gray-800 h-full flex flex-col"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Shimmer overlay */}
            <div className="absolute inset-0 z-20 pointer-events-none shimmer-gradient" />

            {/* Cover image placeholder - aspect ratio 2:3 */}
            <div className="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-dark-50 flex-shrink-0">
                <div className="absolute inset-0 bg-dark-200">
                    <div className="absolute inset-0 skeleton-wave" />
                </div>

                {/* Episode badge placeholder - Top Right */}
                <div className="absolute top-2 right-2 z-[100]">
                    <div className="h-6 w-12 bg-black/60 rounded-md relative overflow-hidden border border-white/20">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                </div>

                {/* Time overlay placeholder - Bottom with larger display */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-8 pb-2 px-2.5 z-[100]">
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full bg-white/10 relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                        <div className="h-3 w-16 bg-white/10 rounded relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Content area */}
            <div className="p-2.5 flex-grow flex flex-col bg-dark-100 rounded-b-xl space-y-2">
                {/* Title placeholder */}
                <div className="space-y-1.5 mb-1">
                    <div className="h-3.5 bg-dark-200 rounded w-full relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                    <div className="h-3.5 bg-dark-200 rounded w-2/3 relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                </div>

                {/* Meta info placeholder */}
                <div className="flex items-center justify-between pt-1 mt-auto">
                    <div className="h-2.5 w-8 bg-dark-200 rounded relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                    <div className="h-2.5 w-12 bg-dark-200 rounded relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Schedule skeleton for grid view
 * @param {number} count - Number of skeleton cards to render
 */
export function ScheduleGridSkeleton({ count = 10 }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <ScheduleCardSkeleton key={i} delay={i * 50} />
            ))}
        </div>
    );
}

/**
 * Schedule skeleton for list view
 * @param {number} count - Number of skeleton rows to render
 */
export function ScheduleListSkeleton({ count = 8 }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-4 p-4 bg-dark-100 rounded-xl border border-gray-800 skeleton-fade-in"
                    style={{ animationDelay: `${i * 60}ms` }}
                >
                    {/* Shimmer overlay */}
                    <div className="absolute inset-0 z-10 pointer-events-none shimmer-gradient" />

                    {/* Thumbnail placeholder */}
                    <div className="w-20 h-28 rounded-lg flex-shrink-0 bg-dark-300 relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>

                    {/* Content placeholder */}
                    <div className="flex-1 space-y-2.5 min-w-0">
                        <div className="h-4 bg-dark-300 rounded w-3/4 relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                        <div className="h-3 bg-dark-300 rounded w-1/2 relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            <div className="h-3 w-16 bg-dark-300 rounded relative overflow-hidden">
                                <div className="absolute inset-0 skeleton-wave" />
                            </div>
                            <div className="h-3 w-12 bg-dark-300 rounded relative overflow-hidden">
                                <div className="absolute inset-0 skeleton-wave" />
                            </div>
                        </div>
                    </div>

                    {/* Time placeholder */}
                    <div className="flex-shrink-0">
                        <div className="h-4 w-20 bg-dark-300 rounded relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Main schedule skeleton component
 * Includes skeletons for day selector, week navigator, and anime grid/list
 */
export function ScheduleSkeleton({ viewMode = 'grid' }) {
    return (
        <div className="min-h-screen pb-20">
            {/* Header skeleton */}
            <div className="bg-dark-100/50 border-b border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-dark-300 rounded-xl relative overflow-hidden">
                                <div className="absolute inset-0 skeleton-wave" />
                            </div>
                            <div className="space-y-2">
                                <div className="h-8 bg-dark-300 rounded w-48 relative overflow-hidden">
                                    <div className="absolute inset-0 skeleton-wave" />
                                </div>
                                <div className="h-4 bg-dark-300 rounded w-64 relative overflow-hidden">
                                    <div className="absolute inset-0 skeleton-wave" />
                                </div>
                            </div>
                        </div>
                        <div className="h-10 w-24 bg-dark-300 rounded-xl relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main content skeleton */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {/* Week navigator skeleton */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-dark-300 rounded-lg relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                        <div className="h-6 bg-dark-300 rounded w-48 relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                        <div className="w-10 h-10 bg-dark-300 rounded-lg relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-wave" />
                        </div>
                    </div>
                    <div className="h-10 w-20 bg-dark-300 rounded-lg relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                </div>

                {/* Day selector skeleton */}
                <div className="mb-8">
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div
                                key={i}
                                className="flex-shrink-0 w-[60px] h-[52px] rounded-lg bg-dark-300 relative overflow-hidden"
                                style={{ animationDelay: `${i * 30}ms` }}
                            >
                                <div className="absolute inset-0 skeleton-wave" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Day header skeleton */}
                <div className="flex items-center justify-between mb-6">
                    <div className="h-6 bg-dark-300 rounded w-32 relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                    <div className="h-4 bg-dark-300 rounded w-24 relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-wave" />
                    </div>
                </div>

                {/* Anime grid/list skeleton */}
                {viewMode === 'grid' ? (
                    <ScheduleGridSkeleton count={10} />
                ) : (
                    <ScheduleListSkeleton count={8} />
                )}
            </div>
        </div>
    );
}

export default ScheduleSkeleton;
