import React, { useState, useEffect, memo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Pin, Lock, Plus, ChevronRight, Clock, Flame, Search, MessageSquare, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { forumsApi } from '../../api/client';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Pagination from '../../components/common/Pagination';
import { preloadForumChunks } from '../../App';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import Avatar from '../../components/forums/Avatar';
import MiniProfileHoverCard from '../../components/common/MiniProfileHoverCard';

const TABS = [
    { key: 'active', label: 'Active', icon: Flame },
    { key: 'new', label: 'Newest', icon: Clock },
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

const getActivityTimestamp = (thread) => thread.updated_at || thread.created_at;

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
            className="forums-thread-card group cursor-pointer p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--forums-accent)]/70"
            style={{
                borderColor: 'var(--forums-accent-weak)',
                background: 'linear-gradient(180deg, var(--forums-surface-soft), var(--forums-surface))',
            }}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <Pin size={14} className="forums-accent-text shrink-0" />
                        {thread.is_locked && <Lock size={14} className="forums-meta-text shrink-0" />}
                        <h3 className="forums-thread-title truncate transition-colors group-hover:text-[var(--forums-accent)]">
                            {thread.title}
                        </h3>
                    </div>
                    <p className="forums-meta-text">Pinned discussion</p>
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
            className="forums-thread-card group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--forums-accent)]/70"
        >
            <div className="flex flex-col gap-4">
                <div className="flex min-w-0 items-center gap-2">
                    {thread.is_locked && <Lock size={14} className="forums-meta-text shrink-0" />}
                    <h3 className="forums-thread-title line-clamp-2 transition-colors group-hover:text-[var(--forums-accent)]">
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

const TrendingThreadItem = memo(({ thread }) => {
    const navigate = useNavigate();
    const activityTime = getActivityTimestamp(thread);
    const activityLabel = activityTime
        ? formatDistanceToNow(new Date(activityTime), { addSuffix: true })
        : 'just now';

    return (
        <button
            type="button"
            onClick={() => navigate(`/forums/thread/${thread.id}`)}
            className="forums-surface-soft w-full cursor-pointer rounded-xl p-4 text-left transition-colors hover:border-[var(--forums-accent-weak)]"
        >
            <p className="forums-thread-title line-clamp-2 text-[1.0625rem] leading-snug">{thread.title}</p>
            <div className="forums-meta-text mt-2 flex items-center gap-2">
                <MessageSquare size={13} />
                <span>{thread.reply_count ?? 0}</span>
                <span>•</span>
                <span>{activityLabel}</span>
            </div>
        </button>
    );
});
TrendingThreadItem.displayName = 'TrendingThreadItem';

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

    // Preload forum chunks on mount
    useEffect(() => {
        preloadForumChunks();
    }, []);

    // Reset page when switching tabs/search
    useEffect(() => { setPage(1); }, [activeTab, debouncedSearch]);

    const {
        data: categories,
        isLoading: categoriesLoading,
        isPlaceholderData: isCategoriesPlaceholder
    } = useQuery({
        queryKey: ['forumCategories'],
        queryFn: forumsApi.getCategories,
        staleTime: 5 * 60 * 1000, // 5 minutes
        placeholderData: keepPreviousData,
    });

    const { data: activeThreads, isLoading: activeLoading, isFetching: activeFetching, isPlaceholderData: activePlaceholder } = useQuery({
        queryKey: ['forumActiveThreads', page],
        queryFn: () => forumsApi.getGlobalFeed(page),
        placeholderData: keepPreviousData,
    });

    const {
        data: trendingData,
        isLoading: trendingLoading,
        isPlaceholderData: trendingPlaceholder
    } = useQuery({
        queryKey: ['forumTrendingThreads'],
        queryFn: () => forumsApi.getGlobalFeed(1),
        staleTime: 30 * 1000,
        placeholderData: keepPreviousData,
    });

    const { data: newThreads, isLoading: newLoading, isFetching: newFetching, isPlaceholderData: newPlaceholder } = useQuery({
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

    const isSearching = debouncedSearch.length >= 2;
    const displayedData = isSearching ? searchResults : (activeTab === 'active' ? activeThreads : newThreads);
    const isContentLoading = isSearching ? searchFetching : (activeTab === 'new' ? newLoading : activeLoading);
    const isContentPlaceholder = isSearching ? false : (activeTab === 'new' ? newPlaceholder : activePlaceholder);
    const isContentRefetching = isSearching ? false : (activeTab === 'new' ? (newFetching && newPlaceholder) : (activeFetching && activePlaceholder));

    // Only show loading UI after 500ms delay AND when we're actually loading NEW data
    const showCategoriesLoading = useDelayedLoading(categoriesLoading && !isCategoriesPlaceholder, 500);
    const showContentLoading = useDelayedLoading(isContentLoading && !isContentPlaceholder, 500);

    const totalPages = displayedData?.count ? Math.ceil(displayedData.count / 20) : 0;

    // AniList-style loading pattern
    const renderCategories = () => {
        if (showCategoriesLoading) {
            return (
                <section>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                        <div>
                            <h2 className="forums-section-title mb-4">Categories</h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="h-[116px] rounded-2xl border border-[var(--forums-border)] bg-[var(--forums-surface)]"></div>
                                ))}
                            </div>
                        </div>
                        <aside>
                            <h2 className="forums-section-title mb-4">Trending Now</h2>
                            <div className="space-y-3">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="h-[84px] rounded-xl border border-[var(--forums-border)] bg-[var(--forums-surface)]"></div>
                                ))}
                            </div>
                        </aside>
                    </div>
                </section>
            );
        }

        if (!categories) {
            // Still within delay window, render nothing to prevent flash
            return null;
        }

        if (categories.results?.length > 0) {
            const trendingThreads = trendingData?.results?.slice(0, 5) || [];
            const showTrendingLoading = trendingLoading && !trendingPlaceholder;

            return (
                <section>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                        <div>
                            <h2 className="forums-section-title mb-4">Categories</h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {categories.results.map(cat => (
                                    <Link
                                        key={cat.id}
                                        to={`/forums/category/${cat.slug}`}
                                        className="forums-thread-card group p-5"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h3 className="text-[1.125rem] font-bold tracking-tight text-[var(--forums-text)] transition-colors group-hover:text-[var(--forums-accent)]">
                                                    {cat.name}
                                                </h3>
                                                {cat.description && (
                                                    <p className="forums-meta-text mt-2 line-clamp-2">{cat.description}</p>
                                                )}
                                            </div>
                                            <ChevronRight size={16} className="forums-meta-text mt-1 shrink-0 transition-colors group-hover:text-[var(--forums-accent)]" />
                                        </div>
                                        <p className="forums-meta-text mt-4">{cat.thread_count || 0} threads</p>
                                    </Link>
                                ))}
                            </div>
                        </div>
                        <aside>
                            <div className="forums-surface p-4">
                                <div className="mb-4 flex items-center gap-2">
                                    <Flame size={16} className="text-[var(--forums-accent)]" />
                                    <h2 className="forums-section-title text-[1.1rem]">Trending Now</h2>
                                </div>

                                {showTrendingLoading ? (
                                    <div className="space-y-3">
                                        {[1, 2, 3, 4, 5].map((i) => (
                                            <div key={i} className="h-[84px] rounded-xl border border-[var(--forums-border)] bg-[var(--forums-surface-soft)]"></div>
                                        ))}
                                    </div>
                                ) : trendingThreads.length > 0 ? (
                                    <div className="space-y-3">
                                        {trendingThreads.map((thread) => (
                                            <TrendingThreadItem key={thread.id} thread={thread} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="forums-meta-text">No trending threads yet.</p>
                                )}
                            </div>
                        </aside>
                    </div>
                </section>
            );
        }

        return null;
    };

    return (
        <div className="forums-page">
            <Helmet>
                <title>Forums | aniShows</title>
                <meta name="description" content="Join the discussion! Talk about your favorite anime, share recommendations, and meet other fans." />
            </Helmet>

            {/* Header */}
            <div className="border-b border-[var(--forums-border)]">
                <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 md:px-6">
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <h1 className="forums-heading">Forums</h1>
                            <p className="forums-body-text mt-2">
                                Discuss your favorite anime, share recommendations, and meet fans.
                            </p>
                        </div>
                        {isAuthenticated ? (
                            <Link
                                to="/forums/create"
                                className="forums-primary-action flex shrink-0 items-center gap-2 px-6 py-3"
                            >
                                <Plus size={18} /> New Thread
                            </Link>
                        ) : (
                            <Link
                                to="/login"
                                className="forums-pill flex shrink-0 items-center gap-2 px-5 py-3 hover:border-[var(--forums-accent-weak)] hover:text-[var(--forums-text)]"
                            >
                                Sign In to Discuss
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 md:px-6">
                {/* Categories */}
                {renderCategories()}

                {/* Threads */}
                <section>
                    <div className="mb-6 flex items-center justify-between">
                        <h2 className="forums-section-title">Threads</h2>
                        {/* Tabs */}
                        <div className="forums-surface-soft flex items-center gap-1 p-1">
                            {TABS.map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={`forums-pill flex items-center gap-1.5 px-4 py-2 ${activeTab === tab.key
                                        ? 'forums-pill-active'
                                        : 'hover:border-[var(--forums-accent-weak)] hover:text-[var(--forums-text)]'
                                        }`}
                                >
                                    <tab.icon size={14} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative mb-6 max-w-md">
                        <Search size={16} className="forums-meta-text absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search threads..."
                            className="forums-search w-full py-3 pl-10 pr-4 text-base outline-none transition-colors focus:border-[var(--forums-accent)]"
                        />
                    </div>

                    {/* Thread List */}
                    <div className="relative min-h-[240px]">
                        {showContentLoading ? (
                            <div className="absolute inset-0 z-10 space-y-4">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="rounded-2xl border border-[var(--forums-border)] bg-[var(--forums-surface)] p-6">
                                        <div className="flex-1 space-y-2">
                                            <div className="h-5 w-3/4 rounded bg-[var(--forums-surface-soft)]"></div>
                                            <div className="h-4 w-1/3 rounded bg-[var(--forums-surface-soft)]"></div>
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

                        {displayedData?.results?.length > 0 ? (
                            <div className="forums-thread-list">
                                {/* Pinned Threads — compact section at top, only page 1 */}
                                {page === 1 && displayedData.results.filter(t => t.is_pinned).length > 0 && (
                                    <div className="forums-thread-list">
                                        {displayedData.results.filter(t => t.is_pinned).map(thread => (
                                            <PinnedThreadRow key={thread.id} thread={thread} />
                                        ))}
                                    </div>
                                )}
                                {/* Regular Threads */}
                                {displayedData.results.filter(t => !t.is_pinned).map(thread => (
                                    <ThreadRow key={thread.id} thread={thread} />
                                ))}
                            </div>
                        ) : !showContentLoading && (
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

                    {/* Pagination */}
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
            </div>
        </div>
    );
};

export default ForumCategoryList;
