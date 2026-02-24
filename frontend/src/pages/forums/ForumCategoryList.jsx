import React, { useState, useEffect, useCallback, memo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Pin, Lock, Plus, ChevronRight, Clock, Flame, Search, MessageSquare, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { forumsApi } from '../../api/forumsApi';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Pagination from '../../components/common/Pagination';
import { preloadForumChunks } from '../../App';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';

const TABS = [
    { key: 'active', label: 'Active', icon: Flame },
    { key: 'new', label: 'Newest', icon: Clock },
];

const Avatar = memo(({ user, size = 'md' }) => {
    const dims = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
    if (user?.avatar) {
        return (
            <img
                src={user.avatar}
                alt={user.username}
                className={`${dims} rounded-full object-cover`}
                loading="lazy"
            />
        );
    }
    return (
        <div className={`${dims} rounded-full bg-accent/15 flex items-center justify-center font-bold text-accent-light`}>
            {user?.username?.substring(0, 2).toUpperCase()}
        </div>
    );
});
Avatar.displayName = 'Avatar';

const PinnedThreadRow = memo(({ thread }) => {
    const navigate = useNavigate();
    return (
        <div
            onClick={() => navigate(`/forums/thread/${thread.id}`)}
            className="group flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-yellow-500/[0.04] transition-colors border-b border-yellow-500/10 last:border-b-0"
        >
            <Pin size={12} className="text-yellow-500 shrink-0" />
            {thread.is_locked && <Lock size={12} className="text-gray-500 shrink-0" />}
            <h3 className="text-sm font-semibold text-gray-300 group-hover:text-yellow-400 transition-colors truncate flex-1">
                {thread.title}
            </h3>
            <div className="flex items-center gap-3 text-gray-500 shrink-0">
                <div className="flex items-center gap-1" title={`${thread.reply_count} replies`}>
                    <MessageSquare size={11} />
                    <span className="text-[11px] font-bold">{thread.reply_count}</span>
                </div>
                <div className="flex items-center gap-1" title={`${thread.view_count} views`}>
                    <Eye size={11} />
                    <span className="text-[11px] font-bold">{thread.view_count}</span>
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
            className="group p-4 hover:bg-white/[0.03] transition-colors border-b border-gray-800/50 last:border-b-0 cursor-pointer"
        >
            <div className="flex flex-col gap-2">
                {/* Title */}
                <div className="flex items-center gap-2">
                    {thread.is_locked && <Lock size={12} className="text-gray-600 shrink-0" />}
                    <h3 className="text-[15px] sm:text-base font-semibold text-white group-hover:text-accent transition-colors truncate">
                        {thread.title}
                    </h3>
                </div>

                {/* Content Preview */}
                <p className="text-sm text-gray-400 line-clamp-1 mb-1 leading-relaxed">
                    {thread.content
                        ? (thread.content.replace(/[#*`]/g, '').length > 150
                            ? thread.content.replace(/[#*`]/g, '').substring(0, 150) + '...'
                            : thread.content.replace(/[#*`]/g, ''))
                        : 'No content...'}
                </p>

                {/* Footer Info */}
                <div className="flex items-center justify-between gap-4 mt-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <Link to={`/profile/${thread.author?.username}`} className="flex items-center gap-2 group/author">
                                <Avatar user={thread.author} size="xs" />
                                <span className="text-[12px] font-bold text-accent-light group-hover/author:text-accent transition-colors truncate">{thread.author?.username}</span>
                            </Link>
                        </div>
                        <span className="text-[10px] text-gray-700">•</span>
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">
                            {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                        </span>
                        <div className="hidden sm:flex items-center gap-1.5 ml-1">
                            {thread.tags?.map(tag => (
                                <span
                                    key={tag.id}
                                    className="px-1 py-0 text-[10px] font-extrabold uppercase tracking-tight"
                                    style={{ color: tag.color }}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-gray-400 shrink-0">
                        <div className="flex items-center gap-1.5" title={`${thread.reply_count} replies`}>
                            <MessageSquare size={11} />
                            <span className="text-[11px] font-bold leading-none">{thread.reply_count}</span>
                        </div>
                        <div className="flex items-center gap-1.5" title={`${thread.view_count} views`}>
                            <Eye size={11} />
                            <span className="text-[11px] font-bold leading-none">{thread.view_count}</span>
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
    const renderCategories = () => {
        if (showCategoriesLoading) {
            return (
                <section>
                    <h2 className="text-lg font-bold text-white mb-4">Categories</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className="h-[104px] bg-dark-100/60 rounded-xl border border-gray-800/50"></div>
                        ))}
                    </div>
                </section>
            );
        }

        if (!categories) {
            // Still within delay window, render nothing to prevent flash
            return null;
        }

        if (categories.results?.length > 0) {
            return (
                <section>
                    <h2 className="text-lg font-bold text-white mb-4">Categories</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {categories.results.map(cat => (
                            <Link
                                key={cat.id}
                                to={`/forums/category/${cat.slug}`}
                                className="group p-4 bg-dark-100/60 border border-gray-800 hover:border-accent/30 rounded-xl transition-all hover:bg-dark-100"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="min-w-0">
                                        <h3 className="font-bold text-white group-hover:text-accent transition-colors">{cat.name}</h3>
                                        {cat.description && (
                                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{cat.description}</p>
                                        )}
                                    </div>
                                    <ChevronRight size={16} className="text-gray-600 group-hover:text-accent transition-colors shrink-0 mt-1" />
                                </div>
                                <p className="mt-3 text-xs text-gray-500">{cat.thread_count || 0} threads</p>
                            </Link>
                        ))}
                    </div>
                </section>
            );
        }

        return null;
    };

    return (
        <div className="min-h-screen">
            <Helmet>
                <title>Forums | aniShows</title>
                <meta name="description" content="Join the discussion! Talk about your favorite anime, share recommendations, and meet other fans." />
            </Helmet>

            {/* Header */}
            <div className="border-b border-gray-800">
                <div className="max-w-6xl mx-auto px-4 md:px-6 pt-10 pb-8">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-white tracking-tight">Forums</h1>
                            <p className="text-sm text-gray-500 mt-1">Discuss your favorite anime, share recommendations, and meet fans.</p>
                        </div>
                        {isAuthenticated ? (
                            <Link
                                to="/forums/create"
                                className="btn-primary flex items-center gap-2 py-2.5 px-6 font-bold text-sm rounded-xl shrink-0"
                            >
                                <Plus size={18} /> New Thread
                            </Link>
                        ) : (
                            <Link
                                to="/login"
                                className="btn-secondary flex items-center gap-2 py-2.5 px-5 font-medium text-sm rounded-xl shrink-0"
                            >
                                Sign In to Discuss
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-10">
                {/* Categories */}
                {renderCategories()}

                {/* Threads */}
                <section>
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-lg font-bold text-white">Threads</h2>
                        {/* Tabs */}
                        <div className="flex items-center gap-1 bg-dark-100 rounded-lg p-0.5 border border-gray-800">
                            {TABS.map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === tab.key
                                        ? 'bg-accent text-white'
                                        : 'text-gray-500 hover:text-white'
                                        }`}
                                >
                                    <tab.icon size={12} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative max-w-md mb-4">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search threads..."
                            className="w-full pl-9 pr-3 py-2 bg-dark-100 border border-gray-800 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent/50 transition-colors"
                        />
                    </div>

                    {/* Thread List */}
                    <div className="bg-dark-100/40 border border-gray-800 rounded-xl overflow-hidden relative min-h-[200px]">
                        {showContentLoading ? (
                            <div className="absolute inset-0 z-10 p-4 space-y-4">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="flex items-center gap-4 border-b border-gray-800/50 pb-4 last:border-0 last:pb-0">
                                        <div className="hidden sm:block w-10 h-10 rounded-full bg-gray-800/40 shrink-0"></div>
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 bg-gray-800/40 rounded w-3/4"></div>
                                            <div className="h-3 bg-gray-800/40 rounded w-1/4"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : isContentRefetching ? (
                            <div className="absolute inset-0 bg-dark/60 z-10 flex items-center justify-center">
                                <LoadingSpinner />
                            </div>
                        ) : null}

                        {displayedData?.results?.length > 0 ? (
                            <>
                                {/* Pinned Threads — compact section at top, only page 1 */}
                                {page === 1 && displayedData.results.filter(t => t.is_pinned).length > 0 && (
                                    <div className="border-b border-yellow-500/10 bg-yellow-500/[0.02]">
                                        {displayedData.results.filter(t => t.is_pinned).map(thread => (
                                            <PinnedThreadRow key={thread.id} thread={thread} />
                                        ))}
                                    </div>
                                )}
                                {/* Regular Threads */}
                                {displayedData.results.filter(t => !t.is_pinned).map(thread => (
                                    <ThreadRow key={thread.id} thread={thread} />
                                ))}
                            </>
                        ) : !showContentLoading && (
                            <div className="py-20 text-center">
                                <h3 className="text-base font-semibold text-gray-400">
                                    {isSearching ? 'No results found' : 'No threads yet'}
                                </h3>
                                <p className="mt-1 text-sm text-gray-600">
                                    {isSearching ? 'Try a different search term.' : 'Be the first to start a discussion!'}
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
