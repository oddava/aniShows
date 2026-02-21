import { useState, memo, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Pin, Lock, Plus, ChevronRight, ArrowLeft, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { forumsApi } from '../../api/forumsApi';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/common/Pagination';
import { preloadForumChunks } from '../../App';
import { ThreadListSkeleton, CategorySkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import Avatar from '../../components/forums/Avatar';

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
            className={`group p-4 rounded-xl border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.99] ${thread.is_pinned
                    ? 'bg-yellow-500/[0.02] border-yellow-500/20 shadow-sm shadow-yellow-500/5'
                    : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.1] shadow-sm'
                }`}
        >
            <div className="flex gap-3">
                <div
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 hidden sm:block"
                >
                    <Link to={`/profile/${thread.author?.username}`}>
                        <Avatar user={thread.author} />
                    </Link>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <h3
                            className="text-[15px] font-semibold text-white group-hover:text-accent transition-colors line-clamp-1"
                        >
                            {thread.is_pinned && <Pin size={12} className="inline mr-1.5 text-yellow-500" />}
                            {thread.is_locked && <Lock size={12} className="inline mr-1.5 text-gray-500" />}
                            {thread.title}
                        </h3>
                        <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
                            <span>{thread.reply_count} replies</span>
                            <span>{thread.view_count} views</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        {thread.tags?.map(tag => (
                            <span
                                key={tag.id}
                                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border border-white/10"
                                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                            >
                                {tag.name}
                            </span>
                        ))}
                        <span className="text-xs text-gray-600 ml-auto" onClick={(e) => e.stopPropagation()}>
                            <Link to={`/profile/${thread.author?.username}`} className="text-accent-light hover:text-accent font-medium">{thread.author?.username}</Link>
                            {' · '}
                            {formatDistanceToNow(new Date(thread.updated_at), { addSuffix: true })}
                        </span>
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
                            {threadsData?.results?.map((thread) => (
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
