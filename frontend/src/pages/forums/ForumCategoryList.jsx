import React, { useState, useEffect, memo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Pagination from '../../components/common/Pagination';
import ErrorState from '../../components/common/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import { preloadForumChunks } from '../../app/routes/community';
import { getTotalPages } from '../../components/forums/buildPostTree';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { ForumCategoryPageSkeleton, ThreadListSkeleton } from '../../components/forums/ForumSkeletons';
import ThreadRow, { forumTabClass } from '../../components/forums/ThreadRow';
import { forumQueries } from '../../api/queries/forums';

const getTimeAgo = (dateString) => {
    if (!dateString) return 'recently';
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};

const RailThreadItem = memo(({ thread, variant }) => {
    const navigate = useNavigate();
    const replies = thread.reply_count ?? 0;

    return (
        <button
            type="button"
            onClick={() => navigate(`/forums/thread/${thread.id}`)}
            className="-mx-3 block w-[calc(100%+1.5rem)] rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
        >
            <p className="line-clamp-2 text-sm font-medium text-[var(--text-1)]">
                {thread.title}
            </p>
            <p className="mt-1 text-sm text-[var(--text-3)] tabular">
                {variant === 'replies'
                    ? `${replies} ${replies === 1 ? 'reply' : 'replies'}`
                    : `Updated ${getTimeAgo(thread.updated_at)}`}
            </p>
        </button>
    );
});
RailThreadItem.displayName = 'RailThreadItem';

const ForumCategoryList = () => {
    const { isAuthenticated } = useAuth();
    const [activeTab, setActiveTab] = useState('active');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        preloadForumChunks();
    }, []);

    useEffect(() => {
        setPage(1);
    }, [activeTab, debouncedSearch]);

    const {
        data: categories,
        isLoading: categoriesLoading,
        isPlaceholderData: isCategoriesPlaceholder,
        error: categoriesError,
        refetch: refetchCategories,
    } = useQuery({
        ...forumQueries.categories(),
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData,
    });

    const {
        data: activeThreads,
        isLoading: activeLoading,
        isFetching: activeFetching,
        isPlaceholderData: activePlaceholder,
        error: activeError,
        refetch: refetchActive,
    } = useQuery({
        ...forumQueries.activeThreads(page),
        placeholderData: keepPreviousData,
    });

    const {
        data: newThreads,
        isLoading: newLoading,
        isFetching: newFetching,
        isPlaceholderData: newPlaceholder,
        error: newError,
        refetch: refetchNew,
    } = useQuery({
        ...forumQueries.newThreads(page),
        placeholderData: keepPreviousData,
        enabled: activeTab === 'new',
    });

    const {
        data: searchResults,
        isFetching: searchFetching,
        error: searchError,
        refetch: refetchSearch,
    } = useQuery({
        ...forumQueries.search(debouncedSearch, page),
        placeholderData: keepPreviousData,
        enabled: debouncedSearch.length >= 2,
    });

    // The rail reads the first page of recently active threads (the same
    // query as the Overview list on page 1, so no second request)
    const {
        data: railFeed,
        isLoading: railLoading,
        isPlaceholderData: railPlaceholder,
        error: railError,
        refetch: refetchRail,
    } = useQuery({
        ...forumQueries.activeThreads(1),
        placeholderData: keepPreviousData,
    });

    const isSearching = debouncedSearch.length >= 2;
    const displayedData = isSearching ? searchResults : (activeTab === 'active' ? activeThreads : newThreads);
    const contentError = isSearching ? searchError : (activeTab === 'active' ? activeError : newError);
    const refetchContent = isSearching ? refetchSearch : (activeTab === 'active' ? refetchActive : refetchNew);
    // The rail shares the Overview page-1 query; its failure is shown once, in the list
    const railSharesContentQuery = !isSearching && activeTab === 'active' && page === 1;
    const isContentLoading = isSearching ? searchFetching : (activeTab === 'new' ? newLoading : activeLoading);
    const isContentPlaceholder = isSearching ? false : (activeTab === 'new' ? newPlaceholder : activePlaceholder);
    const isContentRefetching = isSearching
        ? false
        : (activeTab === 'new' ? (newFetching && newPlaceholder) : (activeFetching && activePlaceholder));

    const delayedCategoriesLoading = useDelayedLoading(categoriesLoading && !isCategoriesPlaceholder, 500);
    const delayedContentLoading = useDelayedLoading(isContentLoading && !isContentPlaceholder, 500);
    const delayedRailLoading = useDelayedLoading(railLoading && !railPlaceholder, 500);

    const isInitialCategoriesLoad = categoriesLoading && !categories;
    const isInitialContentLoad = isContentLoading && !displayedData;
    const isInitialRailLoad = railLoading && !railFeed;

    const showCategoriesLoading = isInitialCategoriesLoad || delayedCategoriesLoading;
    const showContentLoading = isInitialContentLoad || delayedContentLoading;
    const showRailLoading = isInitialRailLoad || delayedRailLoading;

    const shouldShowInitialPageSkeleton = !categories && !displayedData && !railFeed
        && !categoriesError && !contentError && !railError
        && (categoriesLoading || isContentLoading || railLoading);

    const threadResults = displayedData?.results || [];
    const pinnedThreads = (!isSearching && page === 1) ? threadResults.filter((thread) => thread.is_pinned) : [];
    const regularThreads = pinnedThreads.length > 0
        ? threadResults.filter((thread) => !thread.is_pinned)
        : threadResults;
    const totalPages = getTotalPages(displayedData, page);

    const railThreads = railFeed?.results || [];
    // Honest label: page 1 of recent activity, ordered by reply count
    const mostRepliedThreads = [...railThreads]
        .sort((a, b) => (b.reply_count || 0) - (a.reply_count || 0))
        .slice(0, 5);
    const latestActivityThreads = [...railThreads]
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 5);

    if (shouldShowInitialPageSkeleton) {
        return <ForumCategoryPageSkeleton />;
    }

    const listTitle = isSearching ? 'Search results' : activeTab === 'new' ? 'New threads' : 'Recently active threads';

    const renderCategories = () => {
        if (showCategoriesLoading) {
            return (
                <div aria-hidden="true" className="mt-6 flex gap-1">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-28" rounded="rounded-lg" />)}
                </div>
            );
        }

        if (categoriesError && !categories) {
            return (
                <p className="mt-6 flex flex-wrap items-center gap-x-3 text-sm text-[var(--text-2)]">
                    Couldn&apos;t load the categories.
                    <button type="button" onClick={() => refetchCategories()} className="text-link">Try again</button>
                </p>
            );
        }

        if (!categories?.results?.length) return null;

        return (
            <nav aria-label="Forum categories" className="scroll-fade -mx-4 mt-6 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
                <ul className="flex min-w-max gap-1">
                    <li>
                        <Link to="/forums" aria-current="page" className={forumTabClass(true)}>All</Link>
                    </li>
                    {categories.results.map((category) => (
                        <li key={category.id}>
                            <Link to={`/forums/category/${category.slug}`} className={forumTabClass(false)}>
                                {category.name}
                                <span className="text-xs font-medium text-[var(--text-3)] tabular">{category.thread_count || 0}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </nav>
        );
    };

    const renderRightRail = () => {
        if (showRailLoading) {
            return (
                <aside aria-hidden="true" className="space-y-8 xl:sticky xl:top-24">
                    {[1, 2].map((i) => (
                        <div key={i} className="space-y-3">
                            <Skeleton className="h-4 w-28" />
                            {[1, 2, 3, 4].map((j) => <Skeleton key={j} className="h-12 w-full" rounded="rounded-lg" />)}
                        </div>
                    ))}
                </aside>
            );
        }

        if (railError && !railFeed) {
            if (railSharesContentQuery) return null;
            return (
                <aside className="xl:sticky xl:top-24">
                    <ErrorState
                        title="Couldn't load activity"
                        message="Check your connection and try again."
                        onRetry={() => refetchRail()}
                        className="py-6"
                    />
                </aside>
            );
        }

        if (!mostRepliedThreads.length && !latestActivityThreads.length) {
            return null;
        }

        return (
            <aside className="space-y-8 xl:sticky xl:top-24">
                {mostRepliedThreads.length > 0 && (
                    <section>
                        <h2 className="mb-1 text-sm font-medium text-[var(--text-2)]">Most replies</h2>
                        {mostRepliedThreads.map((thread) => (
                            <RailThreadItem key={`replies-${thread.id}`} thread={thread} variant="replies" />
                        ))}
                    </section>
                )}

                {latestActivityThreads.length > 0 && (
                    <section>
                        <h2 className="mb-1 text-sm font-medium text-[var(--text-2)]">Latest activity</h2>
                        {latestActivityThreads.map((thread) => (
                            <RailThreadItem key={`latest-${thread.id}`} thread={thread} variant="latest" />
                        ))}
                    </section>
                )}
            </aside>
        );
    };

    const emptyState = isSearching ? (
        <EmptyState
            actions={(
                <button type="button" onClick={() => setSearchQuery('')} className="btn-secondary text-sm">
                    Clear search
                </button>
            )}
        >
            No threads match &ldquo;{debouncedSearch}&rdquo;.
        </EmptyState>
    ) : (
        <EmptyState
            actions={isAuthenticated ? (
                <Link to="/forums/create" className="btn-primary text-sm">Start a thread</Link>
            ) : (
                <Link to="/login" className="btn-primary text-sm">Sign in to start a thread</Link>
            )}
        >
            No threads yet. Be the first to start a conversation.
        </EmptyState>
    );

    return (
        <div className="forums-page">
            <Helmet>
                <title>Forums | AniShows</title>
                <meta name="description" content="Join the discussion! Talk about your favorite anime, share recommendations, and meet other fans." />
            </Helmet>

            <div className="page-container pt-6 pb-16 md:pt-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="page-title">Forums</h1>
                        <p className="mt-1 text-sm text-[var(--text-2)]">Talk about what you&apos;re watching with other fans.</p>
                    </div>
                    {isAuthenticated ? (
                        <Link to="/forums/create" className="btn-primary text-sm">New thread</Link>
                    ) : (
                        <Link to="/login" className="btn-secondary text-sm">Sign in to post</Link>
                    )}
                </header>

                {renderCategories()}

                <div className="mt-6 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-12">
                    <section className="min-w-0">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                            <label className="relative min-w-0 flex-1">
                                <span className="sr-only">Search threads</span>
                                <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                                <input
                                    type="search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search threads"
                                    className="forum-field min-h-11 py-2.5 pl-10 pr-3 text-sm"
                                />
                            </label>
                            <div role="group" aria-label="Sort threads" className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('active')}
                                    aria-pressed={activeTab === 'active'}
                                    className={forumTabClass(activeTab === 'active')}
                                >
                                    Overview
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('new')}
                                    aria-pressed={activeTab === 'new'}
                                    className={forumTabClass(activeTab === 'new')}
                                >
                                    New threads
                                </button>
                            </div>
                        </div>

                        {pinnedThreads.length > 0 && (
                            <section className="mt-8">
                                <h2 className="mb-3 text-sm font-medium text-[var(--text-2)]">Pinned</h2>
                                <div className="grid gap-2">
                                    {pinnedThreads.map((thread) => (
                                        <ThreadRow key={thread.id} thread={thread} compact />
                                    ))}
                                </div>
                            </section>
                        )}

                        <h2 className="section-title mt-8 mb-4">{listTitle}</h2>

                        <div className="relative min-h-[240px]">
                            {showContentLoading ? (
                                <div className="absolute inset-0 z-10">
                                    <ThreadListSkeleton />
                                </div>
                            ) : isContentRefetching ? (
                                <div className="absolute inset-0 z-10 flex items-start justify-center pt-16">
                                    <LoadingSpinner />
                                </div>
                            ) : null}

                            {contentError && !displayedData ? (
                                <ErrorState
                                    title="Couldn't load threads"
                                    onRetry={() => refetchContent()}
                                />
                            ) : threadResults.length > 0 ? (
                                <div className={`grid gap-2 transition-opacity ${isContentRefetching ? 'opacity-50' : ''}`}>
                                    {regularThreads.map((thread) => (
                                        <ThreadRow key={thread.id} thread={thread} />
                                    ))}
                                </div>
                            ) : !showContentLoading && !isContentLoading && emptyState}
                        </div>

                        {totalPages > 1 && (
                            <div className="mt-8 flex justify-center">
                                <Pagination
                                    currentPage={page}
                                    totalPages={totalPages}
                                    onPageChange={setPage}
                                />
                            </div>
                        )}
                    </section>

                    {renderRightRail()}
                </div>
            </div>
        </div>
    );
};

export default ForumCategoryList;
