import React, { useState, useRef, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
    MessageSquare,
    Heart,
    Clock,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Send,
    ShieldAlert,
    Lock,
    Pin,
    Pencil,
    Trash2,
    X,
    Check
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { forumsApi } from '../../api/forumsApi';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Pagination from '../../components/common/Pagination';
import RichTextEditor from '../../components/forums/RichTextEditor';
import MarkdownRenderer from '../../components/common/MarkdownRenderer';
import { preloadForumChunks } from '../../App';
import { ThreadDetailSkeleton, PostSkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import ThreadedPost from '../../components/forums/ThreadedPost';
import Avatar from '../../components/forums/Avatar';

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

    // Helper to build post tree from flat array
    const buildPostTree = (posts) => {
        if (!posts) return [];

        const postMap = new Map();
        const roots = [];

        // First pass: create map
        posts.forEach(post => {
            postMap.set(post.id, { ...post, replies: [] });
        });

        // Second pass: build tree
        posts.forEach(post => {
            const node = postMap.get(post.id);
            if (post.parent) {
                const parent = postMap.get(post.parent);
                if (parent) {
                    parent.replies.push(node);
                } else {
                    // Parent not in this page, treat as root
                    roots.push(node);
                }
            } else {
                roots.push(node);
            }
        });

        // If we have a focused post, find it and return it as the ONLY root
        if (focusedPostId && postMap.has(focusedPostId)) {
            return [postMap.get(focusedPostId)];
        }

        return roots;
    };

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
        queryKey: ['forumThread', id],
        queryFn: () => forumsApi.getThread(id),
        staleTime: 5 * 60 * 1000, // 5 minutes
        placeholderData: keepPreviousData, // Critical: keeps showing previous thread during load
    });

    // Fetch posts - enabled when thread loads, but uses placeholderData for smooth pagination
    const {
        data: postsData,
        isLoading: isPostsLoading,
        isPlaceholderData: isPostsPlaceholder,
        isFetching: isPostsFetching,
        error: postsError
    } = useQuery({
        queryKey: ['forumPosts', id, page],
        queryFn: () => forumsApi.getPosts(id, page),
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData, // Keeps previous posts during page change
        enabled: !!thread,
    });

    // Only show loading UI after 500ms delay AND when we're actually loading new data
    // If we have cached/previous data (isPlaceholderData), user never sees loading
    const showThreadLoading = useDelayedLoading(isThreadLoading && !isThreadPlaceholder, 500);
    const showPostsLoading = useDelayedLoading(isPostsLoading && !isPostsPlaceholder, 500);

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

    const createPostMutation = useMutation({
        mutationFn: (data) => forumsApi.createPost(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries(['forumPosts', id]);
            queryClient.invalidateQueries(['forumThread', id]);
            setReplyContent('');
            setShowReplyForm(false);
            setReplyTo(null);
            toast.success('Reply posted!');
        },
        onError: (error) => {
            toast.error(error.response?.data?.message || 'Failed to post reply');
        }
    });

    const updateThreadMutation = useMutation({
        mutationFn: (data) => forumsApi.updateThread(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries(['forumThread', id]);
            setEditingThread(false);
            toast.success('Thread updated!');
        }
    });

    const deleteThreadMutation = useMutation({
        mutationFn: () => forumsApi.deleteThread(id),
        onSuccess: () => {
            toast.success('Thread deleted');
            window.location.href = '/forums';
        },
        onError: (error) => {
            toast.error(error.response?.data?.message || 'Failed to delete thread');
        }
    });

    // Cooldown refs to prevent rapid-fire like clicks
    const threadLikeCooldownRef = useRef(false);
    const postLikeCooldowns = useRef(new Set());

    // Idempotent like mutation - only creates likes, never removes
    const likeThreadMutation = useMutation({
        mutationFn: () => forumsApi.likeThread(id),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['forumThread', id] });
            const previous = queryClient.getQueryData(['forumThread', id]);

            queryClient.setQueryData(['forumThread', id], old => {
                if (!old) {
                    return old;
                }
                // Only optimistic update if not already liked
                if (old.is_liked_by_user) {
                    return old;
                }
                const newCount = (old.like_count || 0) + 1;
                return {
                    ...old,
                    is_liked_by_user: true,
                    like_count: newCount,
                };
            });

            const afterOptimistic = queryClient.getQueryData(['forumThread', id]);

            return { previous };
        },
        onSuccess: (data) => {
            queryClient.setQueryData(['forumThread', id], old => {
                if (!old) return old;
                return {
                    ...old,
                    like_count: data.like_count,
                    is_liked_by_user: data.is_liked,
                };
            });
        },
        onError: (err, _vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(['forumThread', id], context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to like thread');
            }
        },
    });

    // Unlike mutation - only removes likes
    const unlikeThreadMutation = useMutation({
        mutationFn: () => forumsApi.unlikeThread(id),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['forumThread', id] });
            const previous = queryClient.getQueryData(['forumThread', id]);
            queryClient.setQueryData(['forumThread', id], old => {
                if (!old) return old;
                // Only optimistic update if currently liked
                if (!old.is_liked_by_user) return old;
                return {
                    ...old,
                    is_liked_by_user: false,
                    like_count: Math.max(0, (old.like_count || 0) - 1),
                };
            });
            return { previous };
        },
        onSuccess: (data) => {
            queryClient.setQueryData(['forumThread', id], old => {
                if (!old) return old;
                return {
                    ...old,
                    like_count: data.like_count,
                    is_liked_by_user: data.is_liked, // Always false for unlike action
                };
            });
        },
        onError: (err, _vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(['forumThread', id], context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to unlike thread');
            }
        },
    });

    // Idempotent like mutation for posts
    const likePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.likePost(postId),
        onMutate: async (postId) => {
            await queryClient.cancelQueries({ queryKey: ['forumPosts', id, page] });
            const previous = queryClient.getQueryData(['forumPosts', id, page]);

            queryClient.setQueryData(['forumPosts', id, page], old => {
                if (!old?.results) {
                    return old;
                }
                const updatedResults = old.results.map(post => {
                    if (post.id !== postId) return post;

                    // Only increment if not already liked
                    if (post.is_liked_by_user) {
                        return post;
                    }

                    const newCount = (post.like_count || 0) + 1;
                    return {
                        ...post,
                        is_liked_by_user: true,
                        like_count: newCount,
                    };
                });

                return { ...old, results: updatedResults };
            });

            return { previous };
        },
        onSuccess: (data, postId) => {
            queryClient.setQueryData(['forumPosts', id, page], old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === postId
                            ? {
                                ...post,
                                like_count: data.like_count,
                                is_liked_by_user: data.is_liked,
                            }
                            : post
                    ),
                };
            });
        },
        onError: (err, _postId, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(['forumPosts', id, page], context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to like reply');
            }
        },
    });

    // Unlike mutation for posts
    const unlikePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.unlikePost(postId),
        onMutate: async (postId) => {
            await queryClient.cancelQueries({ queryKey: ['forumPosts', id, page] });
            const previous = queryClient.getQueryData(['forumPosts', id, page]);
            queryClient.setQueryData(['forumPosts', id, page], old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === postId
                            ? {
                                ...post,
                                // Only decrement if currently liked
                                ...(post.is_liked_by_user ? {
                                    is_liked_by_user: false,
                                    like_count: Math.max(0, (post.like_count || 0) - 1),
                                } : {}),
                            }
                            : post
                    ),
                };
            });
            return { previous };
        },
        onSuccess: (data, postId) => {
            queryClient.setQueryData(['forumPosts', id, page], old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === postId
                            ? {
                                ...post,
                                like_count: data.like_count,
                                is_liked_by_user: data.is_liked,
                            }
                            : post
                    ),
                };
            });
        },
        onError: (err, _postId, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(['forumPosts', id, page], context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to unlike reply');
            }
        },
    });

    const updatePostMutation = useMutation({
        mutationFn: ({ postId, data }) => forumsApi.updatePost(postId, data),
        onSuccess: (data, variables) => {
            // Immediately update the cache with the new content
            queryClient.setQueryData(['forumPosts', id, page], (old) => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === variables.postId
                            ? { ...post, content: variables.data.content, updated_at: new Date().toISOString() }
                            : post
                    )
                };
            });
            setEditingPostId(null);
            toast.success('Reply updated!');
        }
    });

    const deletePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.deletePost(postId),
        onSuccess: () => {
            queryClient.invalidateQueries(['forumPosts', id, page]);
            queryClient.invalidateQueries(['forumThread', id]);
            toast.success('Reply deleted');
        },
        onError: (error) => {
            toast.error(error.response?.data?.message || 'Failed to delete reply');
        }
    });

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
                    <div className="mb-10 lg:w-[85%] mx-auto">
                        <div className="bg-accent/[0.02] rounded-[20px] p-4 border border-accent/20 shadow-sm shadow-accent/5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-3">
                                <div className="flex items-center gap-3.5">
                                    <Link to={`/profile/${thread.author.username}`} className="shrink-0">
                                        <Avatar user={thread.author} />
                                    </Link>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <Link to={`/profile/${thread.author.username}`} className="text-[15px] font-bold text-gray-200 hover:text-white transition-colors">
                                                {thread.author.username}
                                            </Link>
                                            <span className="text-[9px] font-extrabold uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded tracking-wider">Author</span>
                                        </div>
                                        <span className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium mt-0.5">
                                            <Clock size={10} className="opacity-70" /> {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {isOwner(thread.author.username) && (
                                        <div className="flex items-center gap-1 mr-1">
                                            <button
                                                onClick={() => { setEditingThread(true); setEditThreadContent(thread.content); }}
                                                className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                                                title="Edit Thread"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => { if (window.confirm('Delete this thread? This cannot be undone.')) deleteThreadMutation.mutate(); }}
                                                className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                                                title="Delete Thread"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (!user || threadLikeCooldownRef.current) {
                                                return;
                                            }
                                            threadLikeCooldownRef.current = true;
                                            setTimeout(() => { threadLikeCooldownRef.current = false; }, 500);
                                            // Use unlike if already liked, otherwise use like
                                            if (thread?.is_liked_by_user) {
                                                unlikeThreadMutation.mutate();
                                            } else {
                                                likeThreadMutation.mutate();
                                            }
                                        }}
                                        disabled={!user || likeThreadMutation.isPending || unlikeThreadMutation.isPending}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${thread?.is_liked_by_user
                                            ? 'text-pink-500 hover:bg-pink-500/10'
                                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                                            }`}
                                    >
                                        <Heart size={14} className={thread?.is_liked_by_user ? 'fill-current' : ''} />
                                        {(thread?.like_count ?? 0)}
                                    </button>
                                </div>
                            </div>
                            <div>
                                {editingThread ? (
                                    <div className="space-y-3">
                                        <RichTextEditor value={editThreadContent} onChange={setEditThreadContent} placeholder="Edit your post..." className="mb-2" />
                                        <div className="flex items-center gap-2 justify-end">
                                            <button onClick={() => setEditingThread(false)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors">
                                                <X size={14} /> Cancel
                                            </button>
                                            <button
                                                onClick={() => updateThreadMutation.mutate({ content: editThreadContent })}
                                                disabled={updateThreadMutation.isPending}
                                                className="btn-primary flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-lg"
                                            >
                                                <Check size={14} /> Save
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <MarkdownRenderer content={thread.content} className="text-[15px] md:text-base opacity-90 leading-relaxed" />
                                )}
                            </div>

                            {/* Integrated Reply Action */}
                            {user && !thread.is_locked && (
                                <div className="mt-4 pt-4 border-t border-white/[0.04] flex justify-end">
                                    <button
                                        onClick={() => setShowReplyForm(!showReplyForm)}
                                        className={`flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-lg transition-all border ${showReplyForm
                                            ? 'bg-white/5 text-gray-400 border-transparent hover:text-white'
                                            : 'text-accent hover:bg-accent/10 border-accent/20'
                                            }`}
                                    >
                                        <MessageSquare size={14} /> {showReplyForm ? 'Cancel Reply' : 'Write a Reply'}
                                    </button>
                                </div>
                            )}

                            {showReplyForm && user && !thread.is_locked && (
                                <div className="mt-4 pt-4 border-t border-white/[0.04] animate-slide-down-fade">
                                    <form onSubmit={handleReplySubmit}>
                                        <RichTextEditor
                                            value={replyContent}
                                            onChange={setReplyContent}
                                            placeholder="Write your reply..."
                                            className="bg-dark/30 rounded-xl"
                                        />
                                        <div className="mt-4 flex justify-end">
                                            <button
                                                type="submit"
                                                disabled={createPostMutation.isPending || !replyContent.trim()}
                                                className="btn-primary flex items-center gap-2 px-5 py-2 font-bold text-xs rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:shadow-none transition-all"
                                            >
                                                {createPostMutation.isPending ? <LoadingSpinner size={14} /> : <><Send size={14} /> Post Reply</>}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            )}
                        </div>
                    </div>
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
                <div className="lg:w-[85%] mx-auto relative">
                    {/* Replies Header */}
                    {postsData?.count > 0 && (
                        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-800">
                            <div className="flex items-center gap-4">
                                <h3 className="text-sm font-bold text-gray-400">
                                    {focusedPostId ? 'Thread Context' : `${postsData.count} ${postsData.count === 1 ? 'Reply' : 'Replies'}`}
                                </h3>
                                {focusedPostId && (
                                    <button
                                        onClick={() => {
                                            setFocusedPostId(null);
                                            setSearchParams({});
                                        }}
                                        className="text-xs font-bold text-accent hover:text-accent-light bg-accent/10 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        View full discussion
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => setRepliesCollapsed(!repliesCollapsed)}
                                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                            >
                                {repliesCollapsed ? (
                                    <>
                                        <ChevronDown size={14} />
                                        Show Replies
                                    </>
                                ) : (
                                    <>
                                        <ChevronUp size={14} />
                                        Hide Replies
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Collapsed Replies Summary */}
                    {repliesCollapsed && postsData?.count > 0 && (
                        <div className="py-8 text-center">
                            <p className="text-sm text-gray-500 mb-2">
                                {postsData.count} {postsData.count === 1 ? 'reply' : 'replies'} hidden
                            </p>
                            <button
                                onClick={() => setRepliesCollapsed(false)}
                                className="text-accent hover:text-accent-light text-sm font-medium transition-colors"
                            >
                                Show all replies
                            </button>
                        </div>
                    )}

                    {showPostsLoading ? (
                        <div className="space-y-6 w-full">
                            {[1, 2, 3].map(i => (
                                <PostSkeleton key={i} />
                            ))}
                        </div>
                    ) : postsError ? (
                        <div className="py-12 text-center text-gray-500">
                            <p>Failed to load replies. Please try again.</p>
                            <button
                                onClick={() => queryClient.invalidateQueries(['forumPosts', id, page])}
                                className="mt-4 text-accent hover:underline"
                            >
                                Retry
                            </button>
                        </div>
                    ) : !repliesCollapsed ? (
                        <div className="space-y-6">
                            {buildPostTree(postsData?.results).map((post) => (
                                <ThreadedPost
                                    key={post.id}
                                    post={post}
                                    depth={0}
                                    maxDepth={8}
                                    user={user}
                                    isOwner={isOwner}
                                    onEdit={(postId, content) => updatePostMutation.mutate({ postId, data: { content } })}
                                    onDelete={(postId) => deletePostMutation.mutate(postId)}
                                    onLike={(postId) => {
                                        const post = postsData?.results?.find(p => p.id === postId);
                                        if (post?.is_liked_by_user) {
                                            unlikePostMutation.mutate(postId);
                                        } else {
                                            likePostMutation.mutate(postId);
                                        }
                                    }}
                                    onReply={setReplyTo}
                                    editingPostId={editingPostId}
                                    editPostContent={editPostContent}
                                    setEditingPostId={setEditingPostId}
                                    setEditPostContent={setEditPostContent}
                                    replyTo={replyTo}
                                    setReplyTo={setReplyTo}
                                    createPostMutation={createPostMutation}
                                    threadId={id}
                                    focusedPostId={focusedPostId}
                                    threadAuthorUsername={thread.author.username}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>

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
