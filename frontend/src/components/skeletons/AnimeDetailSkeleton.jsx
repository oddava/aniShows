import React from 'react';

export function AnimeDetailSkeleton() {
    return (
        <div className="min-h-screen">
            {/* Banner Skeleton */}
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden bg-dark-200 skeleton-fade-in">
                <div className="absolute inset-0 skeleton-wave" />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent z-10" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent z-10" />
            </div>

            {/* Content Container */}
            <div className="relative -mt-32 px-4 sm:px-6 lg:px-8 pb-16 z-20">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-8 min-w-0">

                        {/* Column 1: Poster & Info Box Skeleton */}
                        <div className="flex flex-col gap-6">
                            {/* Poster */}
                            <div className="flex-shrink-0 mx-auto lg:mx-0 skeleton-fade-in" style={{ animationDelay: '50ms' }}>
                                <div className="w-48 md:w-64 lg:w-full aspect-[2/3] rounded-2xl shadow-2xl bg-dark-200 relative overflow-hidden border border-gray-800">
                                    <div className="absolute inset-0 skeleton-wave" />
                                </div>
                            </div>

                            {/* Info Box Desktop */}
                            <div className="hidden lg:flex flex-col gap-6 bg-dark-100/50 p-6 rounded-2xl border border-gray-800 shadow-xl overflow-hidden skeleton-fade-in" style={{ animationDelay: '100ms' }}>
                                <div className="w-24 h-3 bg-dark-200 rounded relative overflow-hidden mb-2">
                                    <div className="absolute inset-0 skeleton-wave" />
                                </div>
                                <div className="space-y-4">
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div key={i} className="flex justify-between items-center">
                                            <div className="w-16 h-3 bg-dark-200 rounded relative overflow-hidden"><div className="absolute inset-0 skeleton-wave" /></div>
                                            <div className="w-24 h-4 bg-dark-300 rounded relative overflow-hidden"><div className="absolute inset-0 skeleton-wave" /></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Column 2: Main Content Skeleton */}
                        <div className="flex-1 min-w-0 mt-4 lg:mt-0">
                            <div className="text-center lg:text-left mb-8 space-y-4">
                                {/* Title */}
                                <div className="skeleton-fade-in" style={{ animationDelay: '150ms' }}>
                                    <div className="h-10 sm:h-12 md:h-14 bg-dark-200 rounded-xl w-3/4 mx-auto lg:mx-0 relative overflow-hidden mb-2">
                                        <div className="absolute inset-0 skeleton-wave" />
                                    </div>
                                    <div className="h-6 bg-dark-200 rounded-lg w-1/2 mx-auto lg:mx-0 relative overflow-hidden">
                                        <div className="absolute inset-0 skeleton-wave" />
                                    </div>
                                </div>

                                {/* Tags */}
                                <div className="flex flex-wrap justify-center lg:justify-start gap-2 pt-2 skeleton-fade-in" style={{ animationDelay: '200ms' }}>
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <div key={i} className="w-20 h-7 bg-dark-200 rounded-full relative overflow-hidden">
                                            <div className="absolute inset-0 skeleton-wave" />
                                        </div>
                                    ))}
                                </div>

                                {/* Main Actions Box */}
                                <div className="bg-dark-100/40 p-4 sm:p-6 rounded-3xl border border-gray-800/50 shadow-2xl relative overflow-hidden skeleton-fade-in mt-6" style={{ animationDelay: '250ms' }}>
                                    <div className="absolute inset-0 skeleton-wave opacity-50" />
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="w-24 h-8 bg-dark-200 rounded-lg relative overflow-hidden" />
                                        <div className="flex gap-2">
                                            <div className="w-10 h-10 bg-dark-200 rounded-xl relative overflow-hidden" />
                                            <div className="w-10 h-10 bg-dark-200 rounded-xl relative overflow-hidden" />
                                        </div>
                                    </div>
                                    <div className="w-full h-12 bg-dark-200 rounded-xl relative overflow-hidden mt-4" />
                                </div>
                            </div>

                            {/* Tabs Navigation Skeleton */}
                            <div className="flex gap-2 mb-8 skeleton-fade-in" style={{ animationDelay: '300ms' }}>
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="w-24 h-10 bg-dark-200 rounded-xl relative overflow-hidden">
                                        <div className="absolute inset-0 skeleton-wave" />
                                    </div>
                                ))}
                            </div>

                            {/* Synopsis/Overview Content Skeleton */}
                            <div className="space-y-4 skeleton-fade-in" style={{ animationDelay: '350ms' }}>
                                <div className="w-32 h-6 bg-dark-200 rounded-lg relative overflow-hidden mb-4">
                                    <div className="absolute inset-0 skeleton-wave" />
                                </div>
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className={`h-4 bg-dark-200 rounded relative overflow-hidden ${i === 3 ? 'w-2/3' : 'w-full'}`}>
                                        <div className="absolute inset-0 skeleton-wave" />
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}

export default AnimeDetailSkeleton;
