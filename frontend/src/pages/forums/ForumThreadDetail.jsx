import { useState, memo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Clock, Send, ShieldAlert, Pin, Lock, ArrowLeft, ChevronRight, Heart, Trash2, Pencil, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import MarkdownRenderer from '../../components/common/MarkdownRenderer';

import { forumsApi } from '../../api/forumsApi';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Pagination from '../../components/common/Pagination';
import RichTextEditor from '../../components/forums/RichTextEditor';

const Avatar = memo(({ user, size = 'md' }) => {
    const dims = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
    const ring = 'ring-1 ring-white/10';
    if (user?.avatar) {
        return <img src={user.avatar} alt={user.username} className={`${dims} rounded-full object-cover ${ring}`} loading="lazy" />;
    }
    return (
        <div className={`${dims} rounded-full bg-white/5 flex items-center justify-center font-bold text-gray-300 ${ring}`}>
            {user?.username?.substring(0, 2).toUpperCase()}
        </div>
    );
});
Avatar.displayName = 'Avatar';

const ForumThreadDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [replyContent, setReplyContent] = useState('');
    const [showReplyForm, setShowReplyForm] = useState(false);

    // Edit states
    const [editingThread, setEditingThread] = useState(false);
    const [editThreadContent, setEditThreadContent] = useState('');
    const [editingPostId, setEditingPostId] = useState(null);
    const [editPostContent, setEditPostContent] = useState('');

    const { data: thread, isLoading: isThreadLoading } = useQuery({
        queryKey: ['forumThread', id],
        queryFn: () => forumsApi.getThread(id),
    });

    const { data: postsData, isLoading: isPostsLoading, isFetching: isPostsFetching } = useQuery({
        queryKey: ['forumPosts', id, page],
        queryFn: () => forumsApi.getPosts(id, page),
        placeholderData: keepPreviousData,
    });

    const createPostMutation = useMutation({
        mutationFn: (data) => forumsApi.createPost(data),
        onSuccess: () => {
            setReplyContent('');
            setShowReplyForm(false);
            toast.success('Reply posted successfully');
            queryClient.invalidateQueries(['forumPosts', id]);
            queryClient.invalidateQueries(['forumThread', id]);
        },
        onError: (error) => toast.error(error.response?.data?.detail || 'Failed to post reply'),
    });

    const toggleThreadLikeMutation = useMutation({
        mutationFn: () => forumsApi.toggleThreadLike(id),
        onSuccess: () => queryClient.invalidateQueries(['forumThread', id]),
    });

    const togglePostLikeMutation = useMutation({
        mutationFn: (postId) => forumsApi.togglePostLike(postId),
        onSuccess: () => queryClient.invalidateQueries(['forumPosts', id]),
    });

    const updateThreadMutation = useMutation({
        mutationFn: (data) => forumsApi.updateThread(id, data),
        onSuccess: () => {
            setEditingThread(false);
            toast.success('Thread updated');
            queryClient.invalidateQueries(['forumThread', id]);
        },
        onError: () => toast.error('Failed to update thread'),
    });

    const deleteThreadMutation = useMutation({
        mutationFn: () => forumsApi.deleteThread(id),
        onSuccess: () => {
            toast.success('Thread deleted');
            navigate('/forums');
        },
        onError: () => toast.error('Failed to delete thread'),
    });

    const updatePostMutation = useMutation({
        mutationFn: ({ postId, data }) => forumsApi.updatePost(postId, data),
        onSuccess: () => {
            setEditingPostId(null);
            toast.success('Reply updated');
            queryClient.invalidateQueries(['forumPosts', id]);
        },
        onError: () => toast.error('Failed to update reply'),
    });

    const deletePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.deletePost(postId),
        onSuccess: () => {
            toast.success('Reply deleted');
            queryClient.invalidateQueries(['forumPosts', id]);
            queryClient.invalidateQueries(['forumThread', id]);
        },
        onError: () => toast.error('Failed to delete reply'),
    });

    const handleReplySubmit = (e) => {
        e.preventDefault();
        if (!replyContent.trim()) return;
        createPostMutation.mutate({ thread: parseInt(id), content: replyContent });
    };

    const parseMentions = (text) => {
        if (!text) return text;
        return text.replace(/(^|[^\w.-])@(\w+)/g, "$1[@$2](/profile/$2)");
    };

    const isOwner = (authorUsername) => user?.username === authorUsername;

    if (isThreadLoading) {
        return (
            <div className="min-h-screen">
                <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8">
                    <div className="animate-pulse space-y-6 lg:w-[85%] mx-auto">
                        <div className="h-4 bg-gray-800 rounded w-1/4 mb-6"></div>
                        <div className="h-10 bg-gray-800 rounded w-3/4 mb-8"></div>
                        <div className="bg-dark-100 rounded-[20px] p-4 sm:p-5 border border-white/[0.04] h-64"></div>
                        <div className="space-y-6">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-dark-100 rounded-2xl p-4 sm:p-5 border border-white/[0.04] h-32 flex-1"></div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!thread) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-16 text-center">
                <h2 className="text-2xl font-bold text-red-500">Thread not found</h2>
                <Link to="/forums" className="mt-4 text-accent hover:underline">Return to Forums</Link>
            </div>
        );
    }

    return (
        <>
            <Helmet>
                <title>{thread.title} | aniShows Forums</title>
            </Helmet>

            <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-6 lg:w-[85%] mx-auto">
                    <Link to="/forums" className="flex items-center gap-1 hover:text-accent transition-colors">
                        <ArrowLeft size={14} /> Forums
                    </Link>
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
                <div className="mb-6 pb-6 border-b border-gray-800 lg:w-[85%] mx-auto">
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
                    <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">{thread.title}</h1>
                </div>

                {/* Original Post */}
                {page === 1 && (
                    <div className="mb-10 lg:w-[85%] mx-auto">
                        <div className="bg-dark-100 rounded-[20px] p-4 sm:p-5 border border-white/[0.04] shadow-sm">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0 pb-5 mb-5 border-b border-white/[0.04]">
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
                                        onClick={() => user && toggleThreadLikeMutation.mutate()}
                                        disabled={!user || toggleThreadLikeMutation.isPending}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${thread.is_liked_by_user
                                            ? 'text-pink-500 hover:bg-pink-500/10'
                                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                                            }`}
                                    >
                                        <Heart size={14} className={thread.is_liked_by_user ? 'fill-current' : ''} />
                                        {thread.like_count || 0}
                                    </button>
                                </div>
                            </div>
                            <div className="py-2">
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
                                    <>
                                        <MarkdownRenderer content={parseMentions(thread.content)} className="text-[15px] md:text-base opacity-90 leading-relaxed" />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Replies */}
                <div className="space-y-6 lg:w-[85%] mx-auto relative min-h-[200px]">
                    {isPostsLoading ? (
                        <div className="space-y-6 w-full">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="animate-pulse bg-dark-100 rounded-2xl p-4 sm:p-5 border border-white/[0.04] h-32 ml-[4.5rem]"></div>
                            ))}
                        </div>
                    ) : (
                        <>
                            {isPostsFetching && (
                                <div className="absolute inset-0 bg-dark/50 z-10 flex items-center justify-center rounded-xl">
                                    <LoadingSpinner />
                                </div>
                            )}
                            {postsData?.results?.map((post) => (
                                <div key={post.id} className="group flex gap-4 pr-2 sm:pr-0">
                                    {/* Desktop Timeline avatar */}
                                    <div className="shrink-0 hidden sm:flex flex-col items-center gap-2 w-14 pt-4">
                                        <Link to={`/profile/${post.author.username}`} className="shrink-0 z-10">
                                            <Avatar user={post.author} />
                                        </Link>
                                        <div className="w-[2px] h-full bg-white/[0.02] grow rounded-full"></div>
                                    </div>

                                    {/* Reply Card */}
                                    <div className="bg-dark-100 rounded-2xl p-4 sm:p-5 border border-white/[0.04] shadow-sm flex-1 min-w-0">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 pb-4 mb-4 border-b border-white/[0.04]">
                                            <div className="flex items-center gap-3">
                                                <Link to={`/profile/${post.author.username}`} className="shrink-0 sm:hidden">
                                                    <Avatar user={post.author} size="sm" />
                                                </Link>
                                                <div>
                                                    <Link to={`/profile/${post.author.username}`} className="text-sm font-bold text-gray-200 hover:text-white transition-colors">
                                                        {post.author.username}
                                                    </Link>
                                                    <span className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium mt-0.5">
                                                        <Clock size={10} className="opacity-70" /> {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isOwner(post.author.username) && (
                                                    <div className="flex items-center gap-1 mr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => { setEditingPostId(post.id); setEditPostContent(post.content); }}
                                                            className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                                                            title="Edit Reply"
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => { if (window.confirm('Delete this reply?')) deletePostMutation.mutate(post.id); }}
                                                            className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                                                            title="Delete Reply"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => user && togglePostLikeMutation.mutate(post.id)}
                                                    disabled={!user || togglePostLikeMutation.isPending}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${post.is_liked_by_user
                                                        ? 'text-pink-500 hover:bg-pink-500/10'
                                                        : 'text-gray-500 hover:text-white hover:bg-white/5'
                                                        }`}
                                                >
                                                    <Heart size={14} className={post.is_liked_by_user ? 'fill-current' : ''} />
                                                    {post.like_count || 0}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="py-1">
                                            {editingPostId === post.id ? (
                                                <div className="space-y-3">
                                                    <RichTextEditor value={editPostContent} onChange={setEditPostContent} placeholder="Edit your reply..." />
                                                    <div className="flex items-center gap-2 justify-end">
                                                        <button onClick={() => setEditingPostId(null)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors">
                                                            <X size={14} /> Cancel
                                                        </button>
                                                        <button
                                                            onClick={() => updatePostMutation.mutate({ postId: post.id, data: { content: editPostContent } })}
                                                            disabled={updatePostMutation.isPending}
                                                            className="btn-primary flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-lg"
                                                        >
                                                            <Check size={14} /> Save
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <MarkdownRenderer content={parseMentions(post.content)} className="text-[15px] opacity-90 leading-relaxed" />
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
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

                {/* Reply Box */}
                {user ? (
                    thread.is_locked ? (
                        <div className="mt-8 py-8 text-center border border-gray-800 rounded-2xl bg-dark-100/50 text-gray-500 lg:w-[85%] mx-auto">
                            <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <span className="text-sm">This thread has been locked. New replies cannot be posted.</span>
                        </div>
                    ) : showReplyForm ? (
                        <div className="mt-8 bg-dark-100 border border-gray-800 rounded-2xl overflow-hidden lg:w-[85%] mx-auto">
                            <div className="px-5 py-3 border-b border-gray-800 font-bold text-sm text-white flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <MessageSquare size={16} className="text-accent" />
                                    Post a Reply
                                </div>
                                <button type="button" onClick={() => setShowReplyForm(false)} className="px-2 py-1 hover:bg-white/10 text-xs text-gray-400 hover:text-white rounded-lg transition-colors">Cancel</button>
                            </div>
                            <form onSubmit={handleReplySubmit} className="p-5">
                                <RichTextEditor
                                    value={replyContent}
                                    onChange={setReplyContent}
                                    placeholder="Write your reply..."
                                />
                                <div className="mt-4 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={createPostMutation.isPending || !replyContent.trim()}
                                        className="btn-primary flex items-center gap-2 px-6 py-2.5 font-bold text-sm rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {createPostMutation.isPending ? <LoadingSpinner size={18} /> : <><Send size={16} /> Post Reply</>}
                                    </button>
                                </div>
                            </form>
                        </div>
                    ) : (
                        <div className="mt-8 flex justify-end lg:w-[85%] mx-auto">
                            <button
                                onClick={() => setShowReplyForm(true)}
                                className="btn-primary flex items-center gap-2 px-6 py-3 font-bold text-sm rounded-xl shadow-lg shadow-accent/20"
                            >
                                <MessageSquare size={18} /> Write a Reply
                            </button>
                        </div>
                    )
                ) : (
                    <div className="mt-8 py-12 text-center border border-gray-800 rounded-2xl bg-dark-100/50 lg:w-[85%] mx-auto">
                        <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-accent/30" />
                        <h3 className="text-lg font-bold text-white mb-1">Join the Discussion</h3>
                        <p className="text-sm text-gray-500 mb-6">You must be logged in to post a reply.</p>
                        <Link to="/login" className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl">
                            Sign In
                        </Link>
                    </div>
                )}
            </div>
        </>
    );
};

export default ForumThreadDetail;
