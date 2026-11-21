// Mirrors the anime detail page: banner, then the poster/facts column and the
// main column (title, tabs, hairline rows), so nothing jumps when data lands.
const SkeletonBlock = ({ className = '' }) => (
    <div className={`relative overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)] ${className}`}>
        <div className="absolute inset-0 skeleton-wave" />
    </div>
);

const InfoRowsSkeleton = ({ rows = 7 }) => (
    <div className="min-w-0">
        <SkeletonBlock className="mb-4 h-5 w-28" />
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-2">
                <SkeletonBlock className="h-3.5 w-16" />
                <SkeletonBlock className={`${i % 2 === 0 ? 'w-24' : 'w-20'} h-3.5`} />
            </div>
        ))}
    </div>
);

const RowSkeleton = () => (
    <div className="flex h-[60px] items-center gap-3">
        <SkeletonBlock className="h-[60px] w-10 flex-shrink-0" />
        <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-3.5 w-2/3" />
            <SkeletonBlock className="h-3 w-1/3" />
        </div>
    </div>
);

export function AnimeDetailSkeleton() {
    return (
        <div className="min-h-screen anime-detail-page" aria-busy="true">
            <div className="relative h-[34vh] min-h-[260px] overflow-hidden bg-[var(--ink-1)] skeleton-fade-in lg:h-[40vh] lg:min-h-[300px]">
                <div className="absolute inset-0 skeleton-wave" />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
            </div>

            <div className="relative -mt-32 pb-16">
                <div className="page-container">
                    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] gap-8 xl:gap-12 min-w-0">
                        <div className="hidden lg:flex lg:flex-col gap-6">
                            <SkeletonBlock className="w-full aspect-[2/3] !rounded-[var(--radius-lg)]" />
                            <div className="space-y-2">
                                <SkeletonBlock className="h-11 w-full" />
                                <SkeletonBlock className="h-11 w-full" />
                            </div>
                            <InfoRowsSkeleton />
                        </div>

                        <div className="min-w-0">
                            <div className="mb-8 lg:mb-10">
                                <div className="flex items-end gap-4 lg:block">
                                    <SkeletonBlock className="w-[104px] md:w-36 aspect-[2/3] flex-shrink-0 !rounded-[var(--radius-md)] lg:hidden" />
                                    <SkeletonBlock className="h-9 sm:h-11 lg:h-14 flex-1 lg:w-[60%] max-w-2xl" />
                                </div>
                                <SkeletonBlock className="mt-6 h-[132px] w-full lg:hidden" />
                                <div className="mt-6 space-y-3 max-w-3xl lg:mt-5">
                                    <SkeletonBlock className="h-4 w-full" />
                                    <SkeletonBlock className="h-4 w-full" />
                                    <SkeletonBlock className="h-4 w-11/12" />
                                    <SkeletonBlock className="h-4 w-4/5" />
                                </div>
                            </div>

                            <div className="mb-8 flex items-center gap-6 overflow-hidden sm:mb-10">
                                {['w-16', 'w-14', 'w-16', 'w-12', 'w-20'].map((width, i) => (
                                    <div key={i} className="flex min-h-11 flex-shrink-0 items-center">
                                        <SkeletonBlock className={`${width} h-4`} />
                                    </div>
                                ))}
                            </div>

                            <div className="min-h-[300px] space-y-14">
                                <div>
                                    <SkeletonBlock className="mb-4 h-5 w-28" />
                                    <div className="grid grid-cols-1 gap-x-10 gap-y-6 xl:grid-cols-2">
                                        {Array.from({ length: 4 }).map((_, i) => (
                                            <RowSkeleton key={i} />
                                        ))}
                                    </div>
                                </div>
                                <div className="lg:hidden">
                                    <InfoRowsSkeleton rows={5} />
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
