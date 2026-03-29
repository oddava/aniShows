import React, { useState, useEffect, memo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Pin, Lock, Plus, Search, MessageSquare, Eye, Flame, Clock3 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { forumsApi } from '../../api/client';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Pagination from '../../components/common/Pagination';
import { preloadForumChunks } from '../../App';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import Avatar from '../../components/forums/Avatar';
import { ForumCategoryPageSkeleton } from '../../components/forums/ForumSkeletons';
import MiniProfileHoverCard from '../../components/common/MiniProfileHoverCard';

const CATEGORY_DOT_COLORS = [
    'var(--forums-accent)',
    '#38bdf8',
    '#4ade80',
    '#f59e0b',
    '#f472b6',
    '#9489ac',
];

const getThreadPreview = (content) => {
    const plainText = content?.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim() || '';
    if (!plainText) {
        return 'No content yet.';
    }

    return plainText.length > 180
        ? `${plainText.substring(0, 180)}...`
        : plainText;
};

const getCategoryDotColor = (index) => CATEGORY_DOT_COLORS[index % CATEGORY_DOT_COLORS.length];

const getTimeAgo = (dateString) => {
    if (!dateString) return 'recently';
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};

const PinnedThreadRow = memo(({ thread }) => {
    const navigate = useNavigate();
    return (
        <div
            onClick={() => navigate(`/forums/thread/${thread.id}`)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/forums/thread/${thread.id}`);
                }
            }}
            className="forums-pinned-row group flex cursor-pointer items-center justify-between gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--forums-accent)]/70"
        >
            <div className="flex min-w-0 items-center gap-2">
                <Pin size={11} className="forums-accent-text shrink-0" />
                {thread.is_locked && <Lock size={11} className="forums-meta-text shrink-0" />}
                <h3 className="truncate text-[13px] font-semibold text-[var(--forums-text)]">
                    {thread.title}
                </h3>
            </div>
            <div className="forums-meta-text flex shrink-0 items-center gap-2 text-xs">
                <div className="flex items-center gap-1" title={`${thread.reply_count} replies`}>
                    <MessageSquare size={11} />
                    <span className="font-semibold">{thread.reply_count}</span>
                </div>
                <div className="flex items-center gap-1" title={`${thread.view_count} views`}>
                    <Eye size={11} />
                    <span className="font-semibold">{thread.view_count}</span>
                </div>
            </div>
        </div>
    );
});
PinnedThreadRow.displayName = 'PinnedThreadRow';

const ThreadRow = memo(({ thread }) => {
    const navigate = useNavigate();
    return (
        <div
            onClick={() => navigate(`/forums/thread/${thread.id}`)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/forums/thread/${thread.id}`);
                }
            }}
            className="forums-thread-card group cursor-pointer"
        >
            <div className="flex flex-col gap-4">
                <div className="flex min-w-0 items-center gap-2">
                    {thread.is_locked && <Lock size={14} className="forums-meta-text shrink-0" />}
                    <h3 className="forums-thread-title line-clamp-2">
                        {thread.title}
                    </h3>
                </div>

                <p className="forums-body-text line-clamp-2">
                    {getThreadPreview(thread.content)}
                </p>

                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <div onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                                <MiniProfileHoverCard user={thread.author}>
                                    <Link to={`/u/${thread.author?.username}`} className="shrink-0">
                                        <Avatar user={thread.author} size="xs" />
                                    </Link>
                                </MiniProfileHoverCard>
                                <Link
                                    to={`/u/${thread.author?.username}`}
                                    className="truncate text-sm font-semibold text-[var(--forums-accent)] transition-colors hover:text-[var(--forums-accent-hover)]"
                                >
                                    {thread.author?.username}
                                </Link>
                            </div>
                        </div>
                        <span className="forums-meta-text">•</span>
                        <span className="forums-meta-text whitespace-nowrap">
                            {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                            {thread.tags?.map(tag => (
                                <span
                                    key={tag.id}
                                    className="rounded-lg border px-2 py-1 text-sm font-semibold leading-none"
                                    style={{
                                        color: tag.color,
                                        borderColor: `${tag.color}66`,
                                        backgroundColor: `${tag.color}1a`,
                                    }}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="forums-meta-text flex shrink-0 items-center gap-4">
                        <div className="flex items-center gap-1.5" title={`${thread.reply_count} replies`}>
                            <MessageSquare size={14} />
                            <span className="text-sm font-semibold">{thread.reply_count}</span>
                        </div>
                        <div className="flex items-center gap-1.5" title={`${thread.view_count} views`}>
                            <Eye size={14} />
                            <span className="text-sm font-semibold">{thread.view_count}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
ThreadRow.displayName = 'ThreadRow';

const RailThreadItem = memo(({ thread, variant }) => {
    const navigate = useNavigate();

    return (
        <button
            type="button"
            onClick={() => navigate(`/forums/thread/${thread.id}`)}
            className="forums-rail-row w-full text-left"
        >
            <p className="line-clamp-2 text-sm font-semibold text-[var(--forums-text)]">
                {thread.title}
            </p>
            {variant === 'trending' ? (
                <div className="forums-meta-text mt-1.5 flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1">
                        <MessageSquare size={11} />
                        {thread.reply_count ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Eye size={11} />
                        {thread.view_count ?? 0}
                    </span>
                </div>
            ) : (
                <div className="forums-meta-text mt-1.5 inline-flex items-center gap-1 text-xs">
                    <Clock3 size={11} />
                    <span>Updated {getTimeAgo(thread.updated_at)}</span>
                </div>
            )}
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
        isPlaceholderData: isCategoriesPlaceholder
    } = useQuery({
        queryKey: ['forumCategories'],
        queryFn: forumsApi.getCategories,
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData,
    });

    const {
        data: activeThreads,
        isLoading: activeLoading,
        isFetching: activeFetching,
        isPlaceholderData: activePlaceholder
    } = useQuery({
        queryKey: ['forumActiveThreads', page],
        queryFn: () => forumsApi.getGlobalFeed(page),
        placeholderData: keepPreviousData,
    });

    const {
        data: newThreads,
        isLoading: newLoading,
        isFetching: newFetching,
        isPlaceholderData: newPlaceholder
    } = useQuery({
        queryKey: ['forumNewThreads', page],
        queryFn: () => forumsApi.getThreads({ ordering: '-created_at', page }),
        placeholderData: keepPreviousData,
        enabled: activeTab === 'new',
    });

    const { data: searchResults, isFetching: searchFetching } = useQuery({
        queryKey: ['forumSearch', debouncedSearch, page],
        queryFn: () => forumsApi.getThreads({ search: debouncedSearch, page }),
        placeholderData: keepPreviousData,
        enabled: debouncedSearch.length >= 2,
    });

    const {
        data: railFeed,
        isLoading: railLoading,
        isPlaceholderData: railPlaceholder
    } = useQuery({
        queryKey: ['forumRailFeed'],
        queryFn: () => forumsApi.getGlobalFeed(1),
        staleTime: 30 * 1000,
        placeholderData: keepPreviousData,
    });

    const isSearching = debouncedSearch.length >= 2;
    const displayedData = isSearching ? searchResults : (activeTab === 'active' ? activeThreads : newThreads);
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
        && (categoriesLoading || isContentLoading || railLoading);

    const threadResults = displayedData?.results || [];
    const pinnedThreads = (!isSearching && page === 1) ? threadResults.filter((thread) => thread.is_pinned) : [];
    const regularThreads = pinnedThreads.length > 0
        ? threadResults.filter((thread) => !thread.is_pinned)
        : threadResults;
    const totalPages = displayedData?.count ? Math.ceil(displayedData.count / 20) : 0;

    const railThreads = railFeed?.results || [];
    const trendingThreads = [...railThreads]
        .sort((a, b) => (b.reply_count || 0) - (a.reply_count || 0))
        .slice(0, 5);
    const latestActivityThreads = [...railThreads]
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 5);

    if (shouldShowInitialPageSkeleton) {
        return <ForumCategoryPageSkeleton />;
    }

    const renderCategorySidebar = () => {
        if (showCategoriesLoading) {
            return (
                <aside className="h-fit xl:sticky xl:top-24">
                    <div className="mb-3 h-9 rounded-lg border border-[var(--forums-border)]" />
                    <div className="forums-left-strip space-y-1.5">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div
                                key={`cat-${i}`}
                                className="h-7 rounded-md border border-[var(--forums-border)]"
                            />
                        ))}
                    </div>
                </aside>
            );
        }

        if (!categories?.results?.length) {
            return null;
        }

        return (
            <aside className="h-fit xl:sticky xl:top-24">
                {isAuthenticated ? (
                    <Link
                        to="/forums/create"
                        className="forums-primary-action mb-3 flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
                    >
                        <Plus size={14} /> Create
                    </Link>
                ) : (
                    <Link
                        to="/login"
                        className="forums-pill mb-3 flex w-full items-center justify-center gap-2 px-3 py-2 text-xs hover:border-[var(--forums-accent-weak)] hover:text-[var(--forums-text)]"
                    >
                        Sign In
                    </Link>
                )}
                <div className="forums-left-strip">
                    <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--forums-meta)]">
                        Categories
                    </p>
                    <div className="space-y-1">
                        <Link to="/forums" className="forums-left-item is-active">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--forums-accent)]" />
                            <span className="truncate">All</span>
                        </Link>
                        {categories.results.map((category, index) => (
                            <Link
                                key={category.id}
                                to={`/forums/category/${category.slug}`}
                                className="forums-left-item"
                            >
                                <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: getCategoryDotColor(index) }}
                                />
                                <span className="truncate">{category.name}</span>
                                <span className="ml-auto text-[11px] text-[var(--forums-meta)]">
                                    {category.thread_count || 0}
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            </aside>
        );
    };

    const renderRightRail = () => {
        if (showRailLoading) {
            return (
                <aside className="space-y-4 xl:sticky xl:top-24">
                    {[1, 2].map((i) => (
                        <div key={i} className="forums-rail-card">
                            <div className="mb-3 h-4 w-28 rounded border border-[var(--forums-border)]" />
                            <div className="space-y-2">
                                {[1, 2, 3, 4, 5].map((j) => (
                                    <div key={`rail-${i}-${j}`} className="h-14 rounded-md border border-[var(--forums-border)]" />
                                ))}
                            </div>
                        </div>
                    ))}
                </aside>
            );
        }

        if (!trendingThreads.length && !latestActivityThreads.length) {
            return null;
        }

        return (
            <aside className="space-y-4 xl:sticky xl:top-24">
                {trendingThreads.length > 0 && (
                    <section className="forums-rail-card">
                        <div className="mb-3 flex items-center gap-2">
                            <Flame size={13} className="text-[var(--forums-accent)]" />
                            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--forums-meta)]">
                                Trending
                            </h3>
                        </div>
                        <div className="space-y-2">
                            {trendingThreads.map((thread) => (
                                <RailThreadItem key={`trend-${thread.id}`} thread={thread} variant="trending" />
                            ))}
                        </div>
                    </section>
                )}

                {latestActivityThreads.length > 0 && (
                    <section className="forums-rail-card">
                        <div className="mb-3 flex items-center gap-2">
                            <Clock3 size={13} className="text-[var(--forums-accent)]" />
                            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--forums-meta)]">
                                Latest Activity
                            </h3>
                        </div>
                        <div className="space-y-2">
                            {latestActivityThreads.map((thread) => (
                                <RailThreadItem key={`latest-${thread.id}`} thread={thread} variant="latest" />
                            ))}
                        </div>
                    </section>
                )}
            </aside>
        );
    };

    return (
        <div className="forums-page">
            <Helmet>
                <title>Forums | aniShows</title>
                <meta name="description" content="Join the discussion! Talk about your favorite anime, share recommendations, and meet other fans." />
            </Helmet>

            <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[170px_minmax(0,1fr)_280px]">
                    {renderCategorySidebar()}

                    <section className="min-w-0">
                        <div className="mb-4 border-b border-[var(--forums-border)] pb-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                                <div className="relative min-w-0 flex-1">
                                    <Search size={14} className="forums-meta-text absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search threads"
                                        className="forums-search w-full py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[var(--forums-accent)]"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('active')}
                                        className={`forums-pill px-3 py-1.5 text-sm ${activeTab === 'active' ? 'forums-pill-active' : ''}`}
                                    >
                                        Overview
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('new')}
                                        className={`forums-pill px-3 py-1.5 text-sm ${activeTab === 'new' ? 'forums-pill-active' : ''}`}
                                    >
                                        New Threads
                                    </button>
                                </div>
                            </div>
                        </div>

                        {pinnedThreads.length > 0 && (
                            <div className="mb-4">
                                <div className="mb-2 flex items-center gap-3">
                                    <span className="h-px flex-1 bg-[var(--forums-border)]" />
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--forums-meta)]">
                                        Pinned
                                    </span>
                                    <span className="h-px flex-1 bg-[var(--forums-border)]" />
                                </div>
                                <div className="grid gap-2 md:grid-cols-2">
                                    {pinnedThreads.map((thread) => (
                                        <PinnedThreadRow key={thread.id} thread={thread} />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="forums-section-title">
                                {isSearching ? 'Search Results' : activeTab === 'new' ? 'New Threads' : 'Recently Active Threads'}
                            </h2>
                            {!isSearching && (
                                <button
                                    type="button"
                                    onClick={() => setPage(1)}
                                    className="forums-meta-text text-sm hover:text-[var(--forums-text)]"
                                >
                                    View All
                                </button>
                            )}
                        </div>

                        <div className="relative min-h-[240px]">
                            {showContentLoading ? (
                                <div className="absolute inset-0 z-10 space-y-4">
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <div key={i} className="rounded-2xl border border-[var(--forums-border)] p-6">
                                            <div className="flex-1 space-y-2">
                                                <div className="h-5 w-3/4 rounded border border-[var(--forums-border)]"></div>
                                                <div className="h-4 w-1/3 rounded border border-[var(--forums-border)]"></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : isContentRefetching ? (
                                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                                    <div className="forums-surface-soft p-3">
                                        <LoadingSpinner />
                                    </div>
                                </div>
                            ) : null}

                            {threadResults.length > 0 ? (
                                <div className="forums-thread-list">
                                    {regularThreads.map((thread) => (
                                        <ThreadRow key={thread.id} thread={thread} />
                                    ))}
                                </div>
                            ) : !showContentLoading && !isContentLoading && (
                                <div className="forums-surface py-20 text-center">
                                    <h3 className="forums-section-title">
                                        {isSearching ? 'No results found' : 'No threads yet'}
                                    </h3>
                                    <p className="forums-meta-text mt-2">
                                        {isSearching ? 'Try a different search term.' : 'Be the first to start a discussion.'}
                                    </p>
                                </div>
                            )}
                        </div>

                        {totalPages > 1 && (
                            <div className="mt-6 flex justify-center">
                                <Pagination
                                    currentPage={page}
                                    totalPages={totalPages}
                                    onPageChange={setPage}
                                />
                            </div>
                        )}
                    </section>

                    <div className="order-3 xl:order-none">
                        {renderRightRail()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ForumCategoryList;
