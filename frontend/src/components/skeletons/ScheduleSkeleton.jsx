import React from 'react';

/**
 * Schedule card skeleton component
 * Mimics the compact schedule card structure with bottom status bar and info
 */
export function ScheduleCardSkeleton({ delay = 0 }) {
    return (
        <div
            className="relative h-full flex flex-col skeleton-fade-in"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Cover image placeholder */}
            <div className="aspect-[2/3] bg-dark-200 relative overflow-hidden rounded-lg">
                <div className="absolute inset-0 skeleton-shimmer" />

                {/* Airing countdown placeholder */}
                <div className="absolute bottom-2 left-2 right-2 z-30 pointer-events-none">
                    <div className="h-7 px-2.5 rounded-md backdrop-blur-md flex items-center bg-black/65">
                        <div className="h-2.5 w-24 bg-white/15 rounded relative overflow-hidden">
                            <div className="absolute inset-0 skeleton-shimmer" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Title/info footer placeholder */}
            <div className="mt-3 block space-y-2">
                <div className="flex items-start gap-1.5">
                    <div className="mt-[0.28rem] h-2 w-2 shrink-0 rounded-full bg-dark-300 relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-shimmer" />
                    </div>
                    <div className="mt-[0.06rem] h-3 w-10 shrink-0 rounded bg-dark-300 relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-shimmer" />
                    </div>
                    <div className="h-3.5 flex-1 bg-dark-300 rounded relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-shimmer" />
                    </div>
                </div>
                <div className="h-3.5 w-2/3 bg-dark-300 rounded relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-shimmer" />
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
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 anime-card-grid-gap">
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
