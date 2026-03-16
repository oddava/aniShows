import { useState, memo, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Pin, Lock, Plus, ChevronRight, ArrowLeft, MessageSquare, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { forumsApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/common/Pagination';
import { preloadForumChunks } from '../../App';
import { ThreadListSkeleton, CategorySkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import Avatar from '../../components/forums/Avatar';

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

const ThreadCard = memo(({ thread, slug }) => {
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
            className="group p-4 rounded-xl border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.99] bg-white/[0.02] border-white/10 hover:bg-white/[0.04] hover:border-white/20 shadow-sm"
        >
            <div className="flex flex-col gap-2">
                {/* Title */}
                <div className="flex items-center gap-2 min-w-0">
                    {thread.is_locked && <Lock size={12} className="text-gray-500 shrink-0" />}
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
                            <Link to={`/u/${thread.author?.username}`} className="flex items-center gap-2 group/author">
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
ThreadCard.displayName = 'ThreadCard';

const ForumThreadList = () => {
    const { slug } = useParams();
    const { isAuthenticated } = useAuth();
    const [page, setPage] = useState(1);
    const [selectedTag, setSelectedTag] = useState('');

    useEffect(() => {
        preloadForumChunks();
    }, []);

    // Fetch category with placeholderData for smooth navigation
    const {
        data: category,
        isLoading: isCategoryLoading,
        isPlaceholderData: isCategoryPlaceholder
    } = useQuery({
        queryKey: ['forumCategory', slug],
        queryFn: () => forumsApi.getCategory(slug),
        staleTime: 5 * 60 * 1000, // 5 minutes
        placeholderData: keepPreviousData, // Keep showing previous category during load
    });

    const { data: tagsData } = useQuery({
        queryKey: ['forumTags'],
        queryFn: forumsApi.getTags,
        staleTime: 5 * 60 * 1000,
    });

    // Fetch threads with placeholderData for smooth pagination
    const {
        data: threadsData,
        isLoading: isThreadsLoading,
        isPlaceholderData: isThreadsPlaceholder,
        isFetching,
        error: threadsError
    } = useQuery({
        queryKey: ['forumThreads', slug, selectedTag, page],
        queryFn: () => forumsApi.getThreads({
            category__slug: slug,
            tags__slug: selectedTag || undefined,
            page
        }),
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData, // Keep showing previous threads during pagination
    });

    // Only show loading UI after 500ms delay AND when we're actually loading NEW data
    const showCategoryLoading = useDelayedLoading(isCategoryLoading && !isCategoryPlaceholder, 500);
    const showThreadsLoading = useDelayedLoading(isThreadsLoading && !isThreadsPlaceholder, 500);

    const totalPages = typeof threadsData?.count !== 'undefined' ? Math.max(1, Math.ceil(threadsData.count / 20)) : 0;

    // AniList-style loading pattern:
    // 1. If loading for 500ms+ with no cached data, show skeleton
    if (showCategoryLoading) {
        return (
            <div className="min-h-screen">
                <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
                    {/* Breadcrumb skeleton */}
                    <div className="flex items-center gap-2 mb-6">
                        <div className="h-4 bg-gray-800/40 rounded w-24"></div>
                        <ChevronRight size={12} className="text-gray-700" />
                        <div className="h-4 bg-gray-800/40 rounded w-32"></div>
                    </div>

                    {/* Header skeleton */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                        <div>
                            <div className="h-8 bg-gray-800/40 rounded w-48 mb-2"></div>
                            <div className="h-4 bg-gray-800/40 rounded w-72"></div>
                        </div>
                        <div className="h-10 bg-gray-800/40 rounded-xl w-32 shrink-0"></div>
                    </div>

                    {/* Tags skeleton */}
                    <div className="flex gap-2 mb-6">
                        {[1, 2, 3, 4].map(i => <div key={i} className="h-6 w-16 bg-gray-800/40 rounded-lg"></div>)}
                    </div>

                    {/* Thread list skeleton */}
                    <ThreadListSkeleton />
                </div>
            </div>
        );
    }

    // 2. If no data yet but still within 500ms delay, show nothing (prevents flash)
    if (!category) {
        return <div className="min-h-screen"></div>;
    }

    // 3. Have data - render content immediately
    return (
        <div className="min-h-screen">
            <Helmet>
                <title>{category ? `${category.name}` : 'Category'} | aniShows Forums</title>
            </Helmet>

            <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
                    <Link to="/forums" className="flex items-center gap-1 hover:text-accent transition-colors">
                        <ArrowLeft size={14} /> Forums
                    </Link>
                    <ChevronRight size={12} />
                    <span className="text-white font-medium">{category?.name}</span>
                </div>

                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{category?.name}</h1>
                        {category?.description && (
                            <p className="mt-1 text-sm text-gray-500">{category.description}</p>
                        )}
                    </div>
                    {isAuthenticated && (
                        <Link
                            to={`/forums/category/${slug}/create`}
                            className="btn-primary flex items-center gap-2 py-2.5 px-5 font-bold text-sm rounded-xl shrink-0"
                        >
                            <Plus size={18} /> New Thread
                        </Link>
                    )}
                </div>

                {/* Tags */}
                {tagsData?.results && tagsData.results.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-6">
                        <button
                            onClick={() => { setSelectedTag(''); setPage(1); }}
                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${selectedTag === ''
                                ? 'bg-accent text-white'
                                : 'bg-dark-100 text-gray-400 border border-gray-800 hover:border-gray-600'
                                }`}
                        >
                            All
                        </button>
                        {tagsData.results.map(tag => (
                            <button
                                key={tag.id}
                                onClick={() => { setSelectedTag(tag.slug); setPage(1); }}
                                className="px-3 py-1 text-xs font-bold rounded-lg transition-colors border"
                                style={{
                                    backgroundColor: selectedTag === tag.slug ? tag.color : `${tag.color}15`,
                                    borderColor: selectedTag === tag.slug ? tag.color : 'transparent',
                                    color: selectedTag === tag.slug ? '#fff' : tag.color,
                                }}
                            >
                                {tag.name}
                            </button>
                        ))}
                    </div>
                )}

                {/* Threads */}
                <div className="space-y-2 relative min-h-[400px]">
                    {showThreadsLoading ? (
                        <ThreadListSkeleton />
                    ) : threadsError ? (
                        <div className="py-16 text-center">
                            <h3 className="text-lg font-semibold text-gray-400">Failed to load threads</h3>
                            <p className="mt-1 text-sm text-gray-600 mb-4">Please try again later</p>
                            <button
                                onClick={() => window.location.reload()}
                                className="text-accent hover:underline"
                            >
                                Retry
                            </button>
                        </div>
                    ) : (
                        <>
                            {isFetching && (
                                <div className="absolute inset-0 bg-dark/30 z-10 flex items-center justify-center rounded-xl backdrop-blur-sm">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full" />
                                        <span className="text-sm">Updating...</span>
                                    </div>
                                </div>
                            )}

                            {/* Pinned Threads — compact section at top, only page 1 */}
                            {page === 1 && threadsData?.results?.filter(t => t.is_pinned).length > 0 && (
                                <div className="mb-3 rounded-xl border border-yellow-500/15 bg-yellow-500/[0.02] overflow-hidden">
                                    {threadsData.results.filter(t => t.is_pinned).map(thread => (
                                        <PinnedThreadRow key={thread.id} thread={thread} />
                                    ))}
                                </div>
                            )}

                            {/* Regular Threads */}
                            {threadsData?.results?.filter(t => !t.is_pinned).map((thread) => (
                                <ThreadCard key={thread.id} thread={thread} slug={slug} />
                            ))}

                            {(!threadsData?.results || threadsData.results.length === 0) && (
                                <div className="py-16 text-center">
                                    <MessageSquare size={48} className="mx-auto mb-4 text-gray-700" />
                                    <h3 className="text-lg font-semibold text-gray-400">No threads yet</h3>
                                    <p className="mt-1 text-sm text-gray-600">Be the first to start a discussion!</p>
                                </div>
                            )}
                        </>
                    )}
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
            </div>
        </div>
    );
};

export default ForumThreadList;
