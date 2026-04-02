const SkeletonBlock = ({ className = '' }) => (
    <div className={`relative overflow-hidden rounded-lg bg-dark-200 ${className}`}>
        <div className="absolute inset-0 skeleton-wave" />
    </div>
);

const InfoBoxSkeleton = ({ compact = false }) => (
    <div className={`bg-dark-100/50 rounded-2xl border border-gray-800 min-w-0 overflow-hidden ${compact ? 'p-5' : 'p-6'}`}>
        <SkeletonBlock className="h-3 w-24 mb-5 rounded" />
        <div className="space-y-3">
            {Array.from({ length: compact ? 5 : 7 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                    <SkeletonBlock className="h-3 w-16 rounded" />
                    <SkeletonBlock className={`${i % 2 === 0 ? 'w-24' : 'w-20'} h-4 rounded`} />
                </div>
            ))}
        </div>
    </div>
);

const RecommendationDesktopCard = () => (
    <div className="flex gap-4 bg-dark-100/30 p-2 rounded-xl border border-gray-800">
        <SkeletonBlock className="w-20 h-28 rounded-lg flex-shrink-0" />
        <div className="flex-1 py-1 space-y-2">
            <SkeletonBlock className="h-3.5 w-full rounded" />
            <SkeletonBlock className="h-3.5 w-3/4 rounded" />
            <div className="flex items-center gap-2 pt-1">
                <SkeletonBlock className="h-3 w-10 rounded" />
                <SkeletonBlock className="h-3 w-3 rounded-full" />
                <SkeletonBlock className="h-4 w-12 rounded" />
            </div>
        </div>
    </div>
);

const RecommendationMobileCard = () => (
    <div className="flex-shrink-0 w-28 sm:w-32 snap-start">
        <SkeletonBlock className="aspect-[2/3] rounded-lg mb-2 border border-gray-800" />
        <SkeletonBlock className="h-3 w-full rounded mb-1.5" />
        <SkeletonBlock className="h-3 w-5/6 rounded mb-2" />
        <div className="flex items-center gap-1">
            <SkeletonBlock className="h-2.5 w-8 rounded" />
            <SkeletonBlock className="h-2.5 w-2 rounded-full" />
            <SkeletonBlock className="h-3 w-9 rounded" />
        </div>
    </div>
);

export function AnimeDetailSkeleton() {
    return (
        <div className="min-h-screen anime-detail-page">
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden bg-dark-200 skeleton-fade-in">
                <div className="absolute inset-0 skeleton-wave" />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent" />
            </div>

            <div className="relative -mt-32 px-4 sm:px-6 lg:px-8 pb-16">
                <div className="max-w-[1440px] mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-8 min-w-0">
                        <div className="hidden lg:flex lg:flex-col gap-5">
                            <SkeletonBlock className="w-44 sm:w-48 lg:w-full aspect-[2/3] rounded-xl border border-gray-800 shadow-xl" />

                            <div className="space-y-2 w-full">
                                <div className="flex items-start justify-between gap-2">
                                    <SkeletonBlock className="h-10 flex-1 rounded-lg" />
                                    <SkeletonBlock className="w-9 h-9 rounded-lg" />
                                </div>
                            </div>

                            <InfoBoxSkeleton />

                            <div className="bg-dark-100/30 rounded-2xl p-6 border border-gray-800">
                                <div className="flex items-center gap-2 mb-4">
                                    <SkeletonBlock className="w-4 h-4 rounded" />
                                    <SkeletonBlock className="h-3 w-28 rounded" />
                                </div>
                                <div className="flex items-center gap-3">
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <SkeletonBlock key={i} className="w-10 h-10 rounded-full" />
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="text-center lg:text-left mb-8">
                                <div className="lg:hidden mb-8">
                                    <div className="mx-auto flex max-w-[330px] items-end gap-4">
                                        <div className="w-[118px] flex-shrink-0">
                                            <SkeletonBlock className="aspect-[2/3] rounded-xl border border-gray-800 shadow-xl" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <SkeletonBlock className="h-10 flex-1 rounded-lg" />
                                                    <SkeletonBlock className="w-9 h-9 rounded-lg" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-2">
                                    <SkeletonBlock className="h-9 sm:h-12 md:h-14 w-full lg:w-[80%] max-w-3xl rounded-xl mx-auto lg:mx-0" />
                                </div>

                                <div className="text-left mb-8">
                                    <div className="space-y-3 max-w-4xl">
                                        <SkeletonBlock className="h-4 w-full rounded" />
                                        <SkeletonBlock className="h-4 w-full rounded" />
                                        <SkeletonBlock className="h-4 w-11/12 rounded" />
                                        <SkeletonBlock className="h-4 w-4/5 rounded" />
                                    </div>
                                </div>

                                <div className="lg:hidden mt-6 sm:mt-8 mb-8 sm:mb-12 space-y-4 sm:space-y-6">
                                    <InfoBoxSkeleton compact />
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-2 mb-6 sm:mb-10 p-1.5 rounded-xl sm:rounded-2xl border overflow-x-auto scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-1.5 bg-dark-100 border-dark-50">
                                {['w-24', 'w-20', 'w-28', 'w-20'].map((width, i) => (
                                    <SkeletonBlock key={i} className={`${width} h-10 sm:h-11 rounded-lg sm:rounded-xl flex-shrink-0`} />
                                ))}
                            </div>

                            <div className="min-h-[300px]">
                                <div className="space-y-4">
                                    <SkeletonBlock className="h-4 w-24 rounded" />
                                    <SkeletonBlock className="h-4 w-full rounded" />
                                    <SkeletonBlock className="h-4 w-full rounded" />
                                    <SkeletonBlock className="h-4 w-5/6 rounded" />
                                    <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <SkeletonBlock className="h-20 rounded-xl" />
                                        <SkeletonBlock className="h-20 rounded-xl" />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-16 mb-16">
                                <div className="flex items-center justify-between gap-4 mb-6">
                                    <SkeletonBlock className="h-4 w-28 rounded" />
                                    <SkeletonBlock className="h-9 w-32 rounded-lg" />
                                </div>
                                <div className="space-y-4">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="bg-dark-100/40 border border-gray-800 rounded-2xl p-4 sm:p-5 space-y-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3">
                                                    <SkeletonBlock className="w-9 h-9 rounded-full" />
                                                    <SkeletonBlock className="h-3 w-24 rounded" />
                                                </div>
                                                <SkeletonBlock className="h-3 w-14 rounded" />
                                            </div>
                                            <SkeletonBlock className="h-3.5 w-full rounded" />
                                            <SkeletonBlock className="h-3.5 w-11/12 rounded" />
                                            <SkeletonBlock className="h-3.5 w-3/4 rounded" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6 lg:space-y-8 lg:pt-40">
                            <div>
                                <SkeletonBlock className="h-3 w-36 rounded mb-4 sm:mb-6" />
                                <div className="hidden lg:grid grid-cols-1 gap-4">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <RecommendationDesktopCard key={i} />
                                    ))}
                                </div>
                                <div className="lg:hidden flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory">
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <RecommendationMobileCard key={i} />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AnimeDetailSkeleton;
