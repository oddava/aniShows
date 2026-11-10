import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
    ChevronRight,
    ShieldAlert,
    Lock,
    Pin,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/common/Pagination';
import { preloadForumChunks } from '../../App';
import { ThreadDetailSkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { useForumWebSocket } from '../../hooks/useForumWebSocket';
import ThreadOriginalPost from '../../components/forums/ThreadOriginalPost';
import ThreadReplies from '../../components/forums/ThreadReplies';
import useThreadMutations from '../../components/forums/useThreadMutations';
import { forumKeys, forumQueries } from '../../api/queries/forums';

// Breadcrumb skeleton component - static, no animations
const BreadcrumbSkeleton = () => (
    <div className="flex items-center gap-2 text-xs font-bold text-gray-500 mb-4 lg:w-[85%] mx-auto">
        <div className="h-3 bg-gray-800/40 rounded w-12"></div>
        <ChevronRight size={12} className="text-gray-700" />
        <div className="h-3 bg-gray-800/40 rounded w-20"></div>
        <ChevronRight size={12} className="text-gray-700" />
        <div className="h-3 bg-gray-800/40 rounded w-32"></div>
    </div>
);

const ForumThreadDetail = () => {
    const { id } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const page = parseInt(searchParams.get('page') || '1');
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const [replyContent, setReplyContent] = useState('');
    const [editingThread, setEditingThread] = useState(false);
    const [editThreadContent, setEditThreadContent] = useState('');
    const [editingPostId, setEditingPostId] = useState(null);
    const [editPostContent, setEditPostContent] = useState('');
    const [showReplyForm, setShowReplyForm] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const [repliesCollapsed, setRepliesCollapsed] = useState(false);
    const [focusedPostId, setFocusedPostId] = useState(null);

    // Get post ID from URL query params for "Continue this thread"
    useEffect(() => {
        const postId = searchParams.get('post');
        if (postId) {
            setFocusedPostId(parseInt(postId));
        } else {
            setFocusedPostId(null);
        }
    }, [searchParams]);

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
        error: threadError
    } = useQuery({
        ...forumQueries.thread(id),
        staleTime: 5 * 60 * 1000, // 5 minutes
        placeholderData: keepPreviousData, // Critical: keeps showing previous thread during load
    });

    // Fetch posts - enabled when thread loads, but uses placeholderData for smooth pagination
    const {
        data: postsData,
        isLoading: isPostsLoading,
        isPlaceholderData: isPostsPlaceholder,
        error: postsError
    } = useQuery({
        ...forumQueries.posts(id, page),
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData, // Keeps previous posts during page change
        enabled: !!thread,
    });

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
            // Update the post's like count in the cache without a network request
            queryClient.setQueryData(forumKeys.posts(id, page), old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === post_id
                            ? { ...post, like_count }
                            : post
                    ),
                };
            });
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
        if (focusedPostId && postsData?.results && !isPostsLoading) {
            const postId = String(focusedPostId);
            const checkAndScroll = () => {
                const element = document.getElementById(`post-${postId}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            };
            // Try scrolling after posts render
            setTimeout(checkAndScroll, 100);
            // Retry once more after a longer delay
            setTimeout(checkAndScroll, 500);
        }
    }, [focusedPostId, postsData, isPostsLoading]);

    // Replies, thread edits, pins and likes
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
    const { createPostMutation } = mutations;

    const handleReplySubmit = (e) => {
        e.preventDefault();
        if (!replyContent.trim()) return;
        createPostMutation.mutate({ content: replyContent });
    };

    const isOwner = (username) => user?.username === username;

    const setPage = (newPage) => {
        setSearchParams({ page: newPage });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };



    // Error state
    if (threadError) {
        return (
            <div className="container mx-auto px-4 py-32 text-center">
                <ShieldAlert className="w-16 h-16 mx-auto mb-4 text-red-500/50" />
                <h2 className="text-2xl font-bold text-white mb-2">Thread not found</h2>
                <p className="text-gray-500 mb-8">This thread may have been deleted or moved.</p>
                <Link to="/forums" className="btn-primary px-8 py-3 rounded-xl font-bold">Back to Forums</Link>
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

    return (
        <>
            <Helmet>
                <title>{thread.title} | aniShows Forums</title>
                <meta name="description" content={thread.content.substring(0, 150)} />
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
                    <h1 className="text-xl md:text-2xl font-bold text-gray-300 tracking-tight leading-tight">{thread.title}</h1>
                </div>

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
                        {thread.is_locked ? (
                            <div className="py-6 text-center border border-gray-800/50 rounded-2xl bg-dark-100/30 text-gray-500">
                                <div className="flex items-center justify-center gap-2 text-sm font-medium">
                                    <Lock size={14} className="opacity-50" />
                                    This thread is locked
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
                    page={page}
                    thread={thread}
                    user={user}
                    isOwner={isOwner}
                    queryClient={queryClient}
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

                {postsData?.count > 20 && (
                    <div className="mt-10 flex justify-center lg:w-[85%] mx-auto">
                        <Pagination
                            currentPage={page}
                            totalPages={Math.ceil(postsData.count / 20)}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>
        </>
    );
};

export default ForumThreadDetail;
