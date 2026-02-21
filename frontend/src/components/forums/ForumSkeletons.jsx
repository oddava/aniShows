import React, { memo } from 'react';

// Static placeholder style - NO animations
const placeholderBase = 'bg-gray-800/40';

export const ThreadSkeleton = memo(() => (
    <div className="bg-dark-100/50 rounded-xl border border-gray-800/50 p-4">
        <div className="flex gap-3">
            <div className={`w-10 h-10 rounded-full shrink-0 ${placeholderBase}`} />
            <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className={`h-5 rounded w-3/4 ${placeholderBase}`} />
                    <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
                        <div className={`h-3 rounded w-12 ${placeholderBase}`} />
                        <div className={`h-3 rounded w-12 ${placeholderBase}`} />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`h-4 rounded w-20 ${placeholderBase}`} />
                    <div className={`h-4 rounded w-32 ml-auto ${placeholderBase}`} />
                </div>
            </div>
        </div>
    </div>
));
ThreadSkeleton.displayName = 'ThreadSkeleton';

export const PostSkeleton = memo(() => (
    <div className="group flex gap-4 pr-2 sm:pr-0">
        <div className="shrink-0 hidden sm:flex flex-col items-center gap-2 w-14 pt-4">
            <div className={`w-10 h-10 rounded-full ${placeholderBase}`} />
            <div className={`w-[2px] h-full grow rounded-full ${placeholderBase}`} />
        </div>
        <div className="bg-dark-100 rounded-2xl p-4 border border-white/[0.04] shadow-sm flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
                <div className={`w-8 h-8 rounded-full sm:hidden ${placeholderBase}`} />
                <div className="space-y-1.5">
                    <div className={`h-4 rounded w-24 ${placeholderBase}`} />
                    <div className={`h-3 rounded w-20 ${placeholderBase}`} />
                </div>
            </div>
            <div className="space-y-2">
                <div className={`h-4 rounded w-full ${placeholderBase}`} />
                <div className={`h-4 rounded w-5/6 ${placeholderBase}`} />
                <div className={`h-4 rounded w-4/6 ${placeholderBase}`} />
            </div>
        </div>
    </div>
));
PostSkeleton.displayName = 'PostSkeleton';

export const ThreadDetailSkeleton = memo(() => (
    <div className="container mx-auto px-4 pt-8 pb-24 max-w-6xl min-h-screen">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-4 lg:w-[85%] mx-auto">
            <div className={`h-3 rounded w-12 ${placeholderBase}`} />
            <div className={`w-3 h-3 rounded-full ${placeholderBase}`} />
            <div className={`h-3 rounded w-20 ${placeholderBase}`} />
            <div className={`w-3 h-3 rounded-full ${placeholderBase}`} />
            <div className={`h-3 rounded w-32 ${placeholderBase}`} />
        </div>

        {/* Thread header skeleton */}
        <div className="mb-4 lg:w-[85%] mx-auto space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <div className={`h-5 rounded w-16 ${placeholderBase}`} />
                <div className={`h-5 rounded w-20 ${placeholderBase}`} />
            </div>
            <div className={`h-8 rounded w-3/4 ${placeholderBase}`} />
        </div>

        {/* Original post skeleton */}
        <div className="mb-10 lg:w-[85%] mx-auto">
            <div className="bg-dark-100 rounded-[20px] p-4 border border-white/[0.04] shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3.5">
                        <div className={`w-10 h-10 rounded-full shrink-0 ${placeholderBase}`} />
                        <div className="space-y-1.5">
                            <div className={`h-4 rounded w-24 ${placeholderBase}`} />
                            <div className={`h-3 rounded w-20 ${placeholderBase}`} />
                        </div>
                    </div>
                    <div className={`h-8 rounded w-16 ${placeholderBase}`} />
                </div>
                <div className="space-y-2">
                    <div className={`h-4 rounded w-full ${placeholderBase}`} />
                    <div className={`h-4 rounded w-full ${placeholderBase}`} />
                    <div className={`h-4 rounded w-3/4 ${placeholderBase}`} />
                </div>
            </div>
        </div>

        {/* Replies skeleton */}
        <div className="space-y-6 lg:w-[85%] mx-auto">
            {[1, 2, 3].map((i) => (
                <PostSkeleton key={i} />
            ))}
        </div>
    </div>
));
ThreadDetailSkeleton.displayName = 'ThreadDetailSkeleton';

export const ThreadListSkeleton = memo(() => (
    <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
            <ThreadSkeleton key={i} />
        ))}
    </div>
));
ThreadListSkeleton.displayName = 'ThreadListSkeleton';

export const CategorySkeleton = memo(() => (
    <div className="p-4 bg-dark-100/60 border border-gray-800/50 rounded-xl h-[104px]">
        <div className="flex items-start justify-between">
            <div className="min-w-0 space-y-2">
                <div className={`h-5 rounded w-32 ${placeholderBase}`} />
                <div className={`h-3 rounded w-48 ${placeholderBase}`} />
            </div>
            <div className={`w-4 h-4 rounded shrink-0 mt-1 ${placeholderBase}`} />
        </div>
        <div className={`mt-3 h-3 rounded w-20 ${placeholderBase}`} />
    </div>
));
CategorySkeleton.displayName = 'CategorySkeleton';
