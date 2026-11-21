import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
    Bell,
    ChevronRight,
    ShieldAlert,
    Lock,
    Pin,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/common/Pagination';
import ErrorState from '../../components/common/ErrorState';
import { preloadForumChunks } from '../../app/routes/community';
import { ThreadDetailSkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { useForumWebSocket } from '../../hooks/useForumWebSocket';
import ThreadOriginalPost from '../../components/forums/ThreadOriginalPost';
import ThreadReplies from '../../components/forums/ThreadReplies';
import useThreadMutations from '../../components/forums/useThreadMutations';
import { getTotalPages, isTopLevelPost } from '../../components/forums/buildPostTree';
import { patchCachedPosts } from '../../components/forums/postsCache';
import { forumKeys, forumQueries } from '../../api/queries/forums';

const parsePostParam = (value) => {
    const parsed = parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const ForumThreadDetail = () => {
    const { id } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const page = parseInt(searchParams.get('page') || '1', 10) || 1;
    // "Continue this thread": ?post=<id> focuses that post's subtree (fetched with ?root=)
    const focusedPostId = parsePostParam(searchParams.get('post'));
    const { user } = useAuth();
    const isStaff = Boolean(user?.is_staff || user?.is_superuser);
    const queryClient = useQueryClient();

    const [replyContent, setReplyContent] = useState('');
    const [editingThread, setEditingThread] = useState(false);
    const [editThreadContent, setEditThreadContent] = useState('');
    const [editingPostId, setEditingPostId] = useState(null);
    const [editPostContent, setEditPostContent] = useState('');
    const [showReplyForm, setShowReplyForm] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const [repliesCollapsed, setRepliesCollapsed] = useState(false);

    const setFocusedPostId = useCallback((postId) => {
        setSearchParams(postId ? { post: String(postId) } : {});
    }, [setSearchParams]);

    useEffect(() => {
        preloadForumChunks();
    }, []);

    // Clear edit states on thread change
    useEffect(() => {
        setReplyContent('');
        setEditingThread(false);
        setEditThreadContent('');
        setEditingPostId(null);
        setEditPostContent('');
        setShowReplyForm(false);
        setReplyTo(null);
    }, [id]);

    // Fetch thread with placeholderData to keep showing previous content during navigation
    const {
        data: thread,
        isLoading: isThreadLoading,
        isPlaceholderData: isThreadPlaceholder,
        error: threadError,
        refetch: refetchThread,
    } = useQuery({
        ...forumQueries.thread(id),
        staleTime: 5 * 60 * 1000, // 5 minutes
        placeholderData: keepPreviousData, // Critical: keeps showing previous thread during load
    });

    // One page of top-level posts and their replies
    const pageQuery = useQuery({
        ...forumQueries.posts(id, page),
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData, // Keeps previous posts during page change
        enabled: !!thread && !focusedPostId,
    });

    // Focus mode: the focused post and its subtree, wherever it sits
    const subtreeQuery = useQuery({
        ...forumQueries.postSubtree(id, focusedPostId, page),
        staleTime: 60 * 1000,
        placeholderData: keepPreviousData,
        enabled: !!thread && !!focusedPostId,
    });

    const activePosts = focusedPostId ? subtreeQuery : pageQuery;
    const postsData = activePosts.data;
    const isPostsLoading = activePosts.isLoading;
    const isPostsPlaceholder = activePosts.isPlaceholderData;
    const postsError = activePosts.error;

    // Only show loading UI after 500ms delay AND when we're actually loading new data
    // If we have cached/previous data (isPlaceholderData), user never sees loading
    const showThreadLoading = useDelayedLoading(isThreadLoading && !isThreadPlaceholder, 500);
    const showPostsLoading = useDelayedLoading(isPostsLoading && !isPostsPlaceholder, 500);

    // ---- Live forum updates via WebSocket ----
    useForumWebSocket(id, {
        onNewPost: () => {
            // A new reply was posted by another user — refetch posts and thread (reply count)
            queryClient.invalidateQueries({ queryKey: forumKeys.postsAll(id) });
            queryClient.invalidateQueries({ queryKey: forumKeys.thread(id) });
        },
        onPostLiked: ({ post_id, like_count }) => {
            patchCachedPosts(queryClient, id, post_id, { like_count });
        },
        onPostUpdated: (post) => {
            patchCachedPosts(queryClient, id, post.id, {
                content: post.content,
                edited_at: post.edited_at ?? null,
            });
        },
        onPostRestored: () => {
            // The restored post's author and content come back from the server.
            queryClient.invalidateQueries({ queryKey: forumKeys.postsAll(id) });
        },
        onPostRemoved: ({ post_id, removal }) => {
            if (isStaff) {
                // Staff keep the content and see the reason; refetch to get them
                patchCachedPosts(queryClient, id, post_id, { is_removed: true, removal });
                queryClient.invalidateQueries({ queryKey: forumKeys.postsAll(id) });
            } else {
                patchCachedPosts(queryClient, id, post_id, {
                    is_removed: true,
                    removal,
                    content: '',
                    author: null,
                    can_reply: false,
                });
            }
        },
        onThreadLiked: ({ like_count }) => {
            // Update the thread's like count in the cache without a network request
            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) return old;
                return { ...old, like_count };
            });
        },
    });

    // Handle scrolling to focused post after posts load
    useEffect(() => {
        if (!focusedPostId || !postsData?.results || isPostsLoading) return undefined;
        const checkAndScroll = () => {
            const element = document.getElementById(`post-${focusedPostId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        };
        // Try scrolling after posts render, and once more after a longer delay
        const first = setTimeout(checkAndScroll, 100);
        const second = setTimeout(checkAndScroll, 500);
        return () => {
            clearTimeout(first);
            clearTimeout(second);
        };
    }, [focusedPostId, postsData, isPostsLoading]);

    // Replies, thread edits, pins, likes, follow and moderation
    const mutations = useThreadMutations({
        id,
        page,
        queryClient,
        setReplyContent,
        setShowReplyForm,
        setReplyTo,
        setEditingThread,
        setEditingPostId,
    });
    const { createPostMutation, toggleSubscriptionMutation } = mutations;

    const handleReplySubmit = (e) => {
        e.preventDefault();
        if (!replyContent.trim()) return;
        createPostMutation.mutate({ content: replyContent });
    };

    const isOwner = (username) => Boolean(username) && user?.username === username;

    const setPage = (newPage) => {
        // In focus mode the pages are the focused post's direct replies: keep ?post=.
        setSearchParams(focusedPostId ? { post: String(focusedPostId), page: newPage } : { page: newPage });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Error states: a missing (or removed) thread, or a failed load with retry
    if (threadError && !thread) {
        if (threadError.response?.status === 404) {
            return (
                <div className="container mx-auto px-4 py-32 text-center">
                    <ShieldAlert className="w-16 h-16 mx-auto mb-4 text-red-500/50" />
                    <h2 className="text-2xl font-bold text-white mb-2">Thread not found</h2>
                    <p className="text-gray-500 mb-8">This thread may have been deleted or moved.</p>
                    <Link to="/forums" className="btn-primary px-8 py-3 rounded-xl font-bold">Back to Forums</Link>
                </div>
            );
        }
        return (
            <div className="container mx-auto px-4 py-32 max-w-2xl">
                <ErrorState
                    title="Couldn't load this thread"
                    onRetry={() => refetchThread()}
                />
            </div>
        );
    }

    // AniList-style loading pattern:
    // 1. If we have thread data (cached or fresh), render content immediately
    // 2. Only show skeleton after 500ms delay when loading NEW data (no cache)
    // 3. If data loads before 500ms, user never sees loading state

    if (showThreadLoading) {
        // Actually loading for 500ms+ with no cached data
        return <ThreadDetailSkeleton />;
    }

    if (!thread) {
        // No data yet, but still within 500ms delay window
        // Return empty div to prevent layout shift, no flashing
        return <div className="min-h-screen"></div>;
    }

    const totalPages = focusedPostId
        ? getTotalPages(postsData, page, (post) => post.parent === focusedPostId)
        : getTotalPages(postsData, page, isTopLevelPost);
    const isSubscribed = Boolean(thread.is_subscribed);

    return (
        <>
            <Helmet>
                <title>{thread.title} | AniShows Forums</title>
                <meta name="description" content={(thread.content || thread.excerpt || '').substring(0, 150)} />
            </Helmet>
            <div className="container mx-auto px-4 pt-8 pb-24 max-w-6xl min-h-screen">
                {/* Breadcrumbs */}
                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 mb-4 lg:w-[85%] mx-auto overflow-hidden">
                    <Link to="/forums" className="hover:text-accent transition-colors">Forums</Link>
                    {thread.category_name && (
                        <>
                            <ChevronRight size={12} />
                            <Link to={`/forums/category/${thread.category_slug}`} className="hover:text-accent transition-colors">{thread.category_name}</Link>
                        </>
                    )}
                    <ChevronRight size={12} />
                    <span className="text-gray-400 truncate max-w-[200px]">{thread.title}</span>
                </div>

                {/* Thread Header */}
                <div className="mb-4 lg:w-[85%] mx-auto">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        {thread.is_pinned && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase text-yellow-500 bg-yellow-500/10 rounded-md border border-yellow-500/20">
                                <Pin size={10} /> Pinned
                            </span>
                        )}
                        {thread.is_locked && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-400 bg-gray-400/10 rounded-md border border-gray-400/20">
                                <Lock size={10} /> Locked
                            </span>
                        )}
                        {thread.tags?.map(tag => (
                            <span
                                key={tag.id}
                                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md"
                                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                            >
                                {tag.name}
                            </span>
                        ))}
                    </div>
                    <div className="flex items-start justify-between gap-3">
                        <h1 className="text-xl md:text-2xl font-bold text-gray-300 tracking-tight leading-tight">{thread.title}</h1>
                        {user && (
                            <button
                                type="button"
                                onClick={() => toggleSubscriptionMutation.mutate(!isSubscribed)}
                                disabled={toggleSubscriptionMutation.isPending}
                                aria-pressed={isSubscribed}
                                aria-label={isSubscribed ? 'Unfollow thread' : 'Follow thread'}
                                title={isSubscribed ? 'Unfollow thread' : 'Follow thread'}
                                className={`shrink-0 flex items-center gap-1.5 text-xs font-medium transition-colors px-2 py-1 rounded-lg hover:bg-white/5 ${isSubscribed
                                    ? 'text-accent'
                                    : 'text-gray-500 hover:text-gray-300'
                                    }`}
                            >
                                <Bell size={14} className={isSubscribed ? 'fill-current' : ''} />
                                <span className="hidden sm:inline">{isSubscribed ? 'Following' : 'Follow'}</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Removed thread (only staff can still open it) */}
                {thread.is_removed && (
                    <div className="lg:w-[85%] mx-auto mb-4 py-3 px-4 border border-red-500/20 rounded-2xl bg-red-500/[0.04] text-sm text-red-400/80">
                        This thread was removed by a moderator{thread.removal_reason ? `: ${thread.removal_reason}` : '.'} Only staff can see it.
                    </div>
                )}

                {/* Original Post */}
                {page === 1 && (
                    <ThreadOriginalPost
                        thread={thread}
                        user={user}
                        isOwner={isOwner}
                        mutations={mutations}
                        editingThread={editingThread}
                        setEditingThread={setEditingThread}
                        editThreadContent={editThreadContent}
                        setEditThreadContent={setEditThreadContent}
                        showReplyForm={showReplyForm}
                        setShowReplyForm={setShowReplyForm}
                        replyContent={replyContent}
                        setReplyContent={setReplyContent}
                        handleReplySubmit={handleReplySubmit}
                    />
                )}

                {/* Locked / Auth Guest States */}
                {!showReplyForm && (
                    <div className="lg:w-[85%] mx-auto mb-8">
                        {thread.is_locked && !isStaff ? (
                            <div className="py-6 text-center border border-gray-800/50 rounded-2xl bg-dark-100/30 text-gray-500">
                                <div className="flex items-center justify-center gap-2 text-sm font-medium">
                                    <Lock size={14} className="opacity-50" />
                                    This thread is locked.
                                </div>
                            </div>
                        ) : !user && (
                            <div className="py-8 text-center border border-gray-800/50 rounded-2xl bg-dark-100/30">
                                <p className="text-sm text-gray-500 mb-4">You must be logged in to participate</p>
                                <Link to="/login" className="btn-primary px-6 py-2 text-sm font-bold rounded-xl">
                                    Sign In to Reply
                                </Link>
                            </div>
                        )}
                    </div>
                )}

                {/* Replies Section */}
                <ThreadReplies
                    id={id}
                    thread={thread}
                    user={user}
                    isOwner={isOwner}
                    isStaff={isStaff}
                    onRetryPosts={() => activePosts.refetch()}
                    postsData={postsData}
                    postsError={postsError}
                    showPostsLoading={showPostsLoading}
                    focusedPostId={focusedPostId}
                    setFocusedPostId={setFocusedPostId}
                    setSearchParams={setSearchParams}
                    repliesCollapsed={repliesCollapsed}
                    setRepliesCollapsed={setRepliesCollapsed}
                    editingPostId={editingPostId}
                    setEditingPostId={setEditingPostId}
                    editPostContent={editPostContent}
                    setEditPostContent={setEditPostContent}
                    replyTo={replyTo}
                    setReplyTo={setReplyTo}
                    mutations={mutations}
                />

                {totalPages > 1 && (
                    <div className="mt-10 flex justify-center lg:w-[85%] mx-auto">
                        <Pagination
                            currentPage={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>
        </>
    );
};

export default ForumThreadDetail;
