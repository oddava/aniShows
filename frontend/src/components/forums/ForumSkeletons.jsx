import React, { memo } from 'react';
import Skeleton from '../ui/Skeleton';

// Placeholders shaped like the forum rows and posts: soft blocks, no lines.

export const ThreadSkeleton = memo(() => (
    <div aria-hidden="true" className="rounded-[var(--radius-md)] bg-[var(--ink-1)] p-4 md:px-5">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="mt-3 h-3.5 w-full" />
        <Skeleton className="mt-2 h-3.5 w-2/3" />
        <div className="mt-4 flex items-center gap-2">
            <Skeleton className="h-6 w-6" rounded="rounded-full" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="ml-auto h-3.5 w-28" />
        </div>
    </div>
));
ThreadSkeleton.displayName = 'ThreadSkeleton';

export const PostSkeleton = memo(() => (
    <div aria-hidden="true" className="forum-post">
        <div className="mb-3 flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0" rounded="rounded-full" />
            <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-20" />
            </div>
        </div>
        <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
        </div>
    </div>
));
PostSkeleton.displayName = 'PostSkeleton';

export const ThreadDetailSkeleton = memo(() => (
    <div aria-hidden="true" className="page-container min-h-screen pt-6 pb-16 md:pt-10">
        <div className="max-w-3xl">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-10 w-3/4" />
            <div className="panel mt-6">
                <div className="mb-4 flex items-center gap-3">
                    <Skeleton className="h-10 w-10 shrink-0" rounded="rounded-full" />
                    <div className="space-y-1.5">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            </div>
            <div className="mt-10 space-y-3">
                {[1, 2, 3].map((i) => (
                    <PostSkeleton key={i} />
                ))}
            </div>
        </div>
    </div>
));
ThreadDetailSkeleton.displayName = 'ThreadDetailSkeleton';

export const ThreadListSkeleton = memo(() => (
    <div className="grid gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
            <ThreadSkeleton key={i} />
        ))}
    </div>
));
ThreadListSkeleton.displayName = 'ThreadListSkeleton';

export const ForumCategoryPageSkeleton = memo(() => (
    <div aria-hidden="true" className="forums-page">
        <div className="page-container pt-6 pb-16 md:pt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <Skeleton className="h-10 w-40" />
                    <Skeleton className="mt-3 h-3.5 w-64" />
                </div>
                <Skeleton className="h-11 w-32" rounded="rounded-lg" />
            </div>
            <div className="mt-6 flex gap-1">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-28" rounded="rounded-lg" />)}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-12">
                <section className="min-w-0">
                    <Skeleton className="h-11 w-full" rounded="rounded-lg" />
                    <Skeleton className="mt-8 mb-4 h-6 w-52" />
                    <ThreadListSkeleton />
                </section>
                <div className="hidden space-y-8 xl:block">
                    {[1, 2].map((i) => (
                        <div key={i} className="space-y-3">
                            <Skeleton className="h-4 w-28" />
                            {[1, 2, 3, 4].map((j) => <Skeleton key={j} className="h-12 w-full" rounded="rounded-lg" />)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </div>
));
ForumCategoryPageSkeleton.displayName = 'ForumCategoryPageSkeleton';
