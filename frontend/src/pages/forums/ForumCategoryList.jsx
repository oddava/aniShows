import React, { useState, useEffect, memo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Pin, Lock, Plus, Search, MessageSquare, Eye } from 'lucide-react';
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

const getThreadPreview = (content) => {
    const plainText = content?.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim() || '';
    if (!plainText) {
        return 'No content yet.';
    }

    return plainText.length > 180
        ? `${plainText.substring(0, 180)}...`
        : plainText;
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
            className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--forums-accent-weak)] bg-[var(--forums-surface-soft)] px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--forums-accent)]/70"
        >
            <div className="flex min-w-0 items-center gap-2">
                <Pin size={12} className="forums-accent-text shrink-0" />
                {thread.is_locked && <Lock size={12} className="forums-meta-text shrink-0" />}
                <h3 className="truncate text-sm font-semibold text-[var(--forums-text)] transition-colors group-hover:text-[var(--forums-accent)]">
                    {thread.title}
                </h3>
            </div>
            <div className="forums-meta-text flex shrink-0 items-center gap-3 text-xs">
                <div className="flex items-center gap-1" title={`${thread.reply_count} replies`}>
                    <MessageSquare size={12} />
                    <span className="font-semibold">{thread.reply_count}</span>
                </div>
                <div className="flex items-center gap-1" title={`${thread.view_count} views`}>
                    <Eye size={12} />
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
    const renderCategorySidebar = () => {
        if (showCategoriesLoading) {
            return (
                <aside className="h-fit lg:sticky lg:top-24">
                    <div className="mb-3 h-9 rounded-lg border border-[var(--forums-border)] bg-[var(--forums-surface-soft)]" />
                    <div className="mb-4 h-9 rounded-lg border border-[var(--forums-border)] bg-[var(--forums-surface-soft)]" />
                    <div className="space-y-1.5">
                        {[1, 2, 3].map((i) => (
                            <div key={`feed-${i}`} className="h-7 rounded-md border border-[var(--forums-border)] bg-[var(--forums-surface-soft)]" />
                        ))}
                    </div>
                    <div className="mt-4 space-y-1.5">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={`cat-${i}`} className="h-6 rounded-md border border-[var(--forums-border)] bg-[var(--forums-surface-soft)]" />
                        ))}
                    </div>
                </aside>
            );
        }

        if (!categories) {
            // Still within delay window, render nothing to prevent flash
            return null;
        }

        if (categories.results?.length > 0) {
            return (
                <aside className="h-fit lg:sticky lg:top-24">
                    {isAuthenticated ? (
                        <Link
                            to="/forums/create"
                            className="forums-primary-action mb-3 flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
                        >
                            <Plus size={14} /> Create Thread
                        </Link>
                    ) : (
                        <Link
                            to="/login"
                            className="forums-pill mb-3 flex w-full items-center justify-center gap-2 px-3 py-2 text-xs hover:border-[var(--forums-accent-weak)] hover:text-[var(--forums-text)]"
                        >
                            Sign In to Discuss
                        </Link>
                    )}

                    <div className="relative mb-4">
                        <Search size={14} className="forums-meta-text absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search forum"
                            className="forums-search w-full py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[var(--forums-accent)]"
                        />
                    </div>

                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--forums-meta)]">Feed</p>
                    <div className="space-y-1.5">
                        <button
                            type="button"
                            onClick={() => setActiveTab('active')}
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${activeTab === 'active'
                                ? 'bg-[var(--forums-surface-soft)] text-[var(--forums-text)]'
                                : 'text-[var(--forums-meta)] hover:bg-[var(--forums-surface-soft)] hover:text-[var(--forums-text)]'
                                }`}
                        >
                            Overview
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('new')}
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${activeTab === 'new'
                                ? 'bg-[var(--forums-surface-soft)] text-[var(--forums-text)]'
                                : 'text-[var(--forums-meta)] hover:bg-[var(--forums-surface-soft)] hover:text-[var(--forums-text)]'
                                }`}
                        >
                            New Threads
                        </button>
                    </div>

                    <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--forums-meta)]">Categories</p>
                    <div className="space-y-1">
                        <Link
                            to="/forums"
                            className="block rounded-md px-3 py-1 text-sm text-[var(--forums-text)] hover:bg-[var(--forums-surface-soft)]"
                        >
                            All
                        </Link>
                        {categories.results.map(cat => (
                            <Link
                                key={cat.id}
                                to={`/forums/category/${cat.slug}`}
                                className="group flex items-center justify-between gap-2 rounded-md px-3 py-1 text-sm text-[var(--forums-meta)] transition-colors hover:bg-[var(--forums-surface-soft)] hover:text-[var(--forums-text)]"
                            >
                                <span className="truncate">{cat.name}</span>
                                <span className="text-xs text-[var(--forums-meta)]">{cat.thread_count || 0}</span>
                            </Link>
                        ))}
                    </div>
                </aside>
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

            <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
                    {/* Categories Sidebar */}
                    {renderCategorySidebar()}

                    {/* Right Content */}
                    <section className="min-w-0">
                        {page === 1 && !isSearching && displayedData?.results?.filter(t => t.is_pinned).length > 0 && (
                            <div className="mb-6 grid gap-2 md:grid-cols-2">
                                {displayedData.results.filter(t => t.is_pinned).map(thread => (
                                    <PinnedThreadRow key={thread.id} thread={thread} />
                                ))}
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
        </div>
    );
};

export default ForumCategoryList;
