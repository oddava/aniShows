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
import { ThreadListSkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import Avatar from '../../components/forums/Avatar';

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

const ThreadCard = memo(({ thread }) => {
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
                            <Link to={`/u/${thread.author?.username}`} className="group/author flex items-center gap-2">
                                <Avatar user={thread.author} size="xs" />
                                <span className="truncate text-sm font-semibold text-[var(--forums-accent)] transition-colors group-hover/author:text-[var(--forums-accent-hover)]">
                                    {thread.author?.username}
                                </span>
                            </Link>
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
            <div className="forums-page">
                <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
                    {/* Breadcrumb skeleton */}
                    <div className="mb-6 flex items-center gap-2">
                        <div className="h-4 w-24 rounded bg-[var(--forums-surface-soft)]"></div>
                        <ChevronRight size={12} className="forums-meta-text" />
                        <div className="h-4 w-32 rounded bg-[var(--forums-surface-soft)]"></div>
                    </div>

                    {/* Header skeleton */}
                    <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <div className="mb-2 h-8 w-48 rounded bg-[var(--forums-surface-soft)]"></div>
                            <div className="h-4 w-72 rounded bg-[var(--forums-surface-soft)]"></div>
                        </div>
                        <div className="h-10 w-32 shrink-0 rounded-xl bg-[var(--forums-surface-soft)]"></div>
                    </div>

                    {/* Tags skeleton */}
                    <div className="mb-6 flex gap-2">
                        {[1, 2, 3, 4].map((i) => <div key={i} className="h-8 w-20 rounded-lg bg-[var(--forums-surface-soft)]"></div>)}
                    </div>

                    {/* Thread list skeleton */}
                    <ThreadListSkeleton />
                </div>
            </div>
        );
    }

    // 2. If no data yet but still within 500ms delay, show nothing (prevents flash)
    if (!category) {
        return <div className="forums-page"></div>;
    }

    // 3. Have data - render content immediately
    return (
        <div className="forums-page">
            <Helmet>
                <title>{category ? `${category.name}` : 'Category'} | aniShows Forums</title>
            </Helmet>

            <div className="mx-auto max-w-5xl px-4 py-10 md:px-6">
                {/* Breadcrumb */}
                <div className="forums-meta-text mb-8 flex items-center gap-2">
                    <Link to="/forums" className="flex items-center gap-1 transition-colors hover:text-[var(--forums-accent)]">
                        <ArrowLeft size={14} /> Forums
                    </Link>
                    <ChevronRight size={12} />
                    <span className="font-semibold text-[var(--forums-text)]">{category?.name}</span>
                </div>

                {/* Header */}
                <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                    <div>
                        <h1 className="forums-heading">{category?.name}</h1>
                        {category?.description && (
                            <p className="forums-body-text mt-2 max-w-2xl">{category.description}</p>
                        )}
                    </div>
                    {isAuthenticated && (
                        <Link
                            to={`/forums/category/${slug}/create`}
                            className="forums-primary-action flex shrink-0 items-center gap-2 px-5 py-3"
                        >
                            <Plus size={18} /> New Thread
                        </Link>
                    )}
                </div>

                {/* Tags */}
                {tagsData?.results && tagsData.results.length > 0 && (
                    <div className="mb-8 flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => { setSelectedTag(''); setPage(1); }}
                            className={`forums-pill px-4 py-2 ${selectedTag === ''
                                ? 'forums-pill-active'
                                : 'hover:border-[var(--forums-accent-weak)] hover:text-[var(--forums-text)]'
                                }`}
                        >
                            All
                        </button>
                        {tagsData.results.map(tag => (
                            <button
                                key={tag.id}
                                onClick={() => { setSelectedTag(tag.slug); setPage(1); }}
                                className="rounded-lg border px-4 py-2 text-sm font-semibold transition-colors"
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
                <div className="forums-thread-list relative min-h-[400px]">
                    {showThreadsLoading ? (
                        <ThreadListSkeleton />
                    ) : threadsError ? (
                        <div className="forums-surface py-16 text-center">
                            <h3 className="forums-section-title">Failed to load threads</h3>
                            <p className="forums-meta-text mb-4 mt-2">Please try again later.</p>
                            <button
                                onClick={() => window.location.reload()}
                                className="text-sm font-semibold text-[var(--forums-accent)] hover:underline"
                            >
                                Retry
                            </button>
                        </div>
                    ) : (
                        <>
                            {isFetching && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/30 backdrop-blur-sm">
                                    <div className="forums-surface-soft flex items-center gap-2 px-4 py-3">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--forums-accent-weak)] border-t-[var(--forums-accent)]" />
                                        <span className="forums-meta-text">Updating...</span>
                                    </div>
                                </div>
                            )}

                            {/* Pinned Threads — compact section at top, only page 1 */}
                            {page === 1 && threadsData?.results?.filter(t => t.is_pinned).length > 0 && (
                                <div className="forums-thread-list">
                                    {threadsData.results.filter(t => t.is_pinned).map(thread => (
                                        <PinnedThreadRow key={thread.id} thread={thread} />
                                    ))}
                                </div>
                            )}

                            {/* Regular Threads */}
                            {threadsData?.results?.filter(t => !t.is_pinned).map((thread) => (
                                <ThreadCard key={thread.id} thread={thread} />
                            ))}

                            {(!threadsData?.results || threadsData.results.length === 0) && (
                                <div className="forums-surface py-16 text-center">
                                    <MessageSquare size={48} className="mx-auto mb-4 text-[var(--forums-meta)]" />
                                    <h3 className="forums-section-title">No threads yet</h3>
                                    <p className="forums-meta-text mt-2">Be the first to start a discussion.</p>
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
