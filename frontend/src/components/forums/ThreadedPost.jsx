import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Pencil, Trash2, ChevronDown, ChevronUp, CornerDownRight, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import Avatar from './Avatar';
import MarkdownRenderer from '../common/MarkdownRenderer';
import RichTextEditor from './RichTextEditor';

const ThreadedPost = ({
    post,
    depth = 0,
    maxDepth = 8,
    user,
    isOwner,
    onEdit,
    onDelete,
    onLike,
    onReply,
    editingPostId,
    editPostContent,
    setEditingPostId,
    setEditPostContent,
    replyTo,
    setReplyTo,
    createPostMutation,
    threadId,
    focusedPostId,
    threadAuthorUsername
}) => {
    const navigate = useNavigate();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showReplyForm, setShowReplyForm] = useState(false);
    const [replyContent, setReplyContent] = useState('');
    const isFocused = focusedPostId === post.id;

    // Handle "Continue this thread" - navigate with post param
    const handleContinueThread = (e) => {
        e.preventDefault();
        navigate(`/forums/thread/${threadId}?post=${post.id}`, { replace: false });
    };

    const isEditing = editingPostId === post.id;
    const isReplying = replyTo?.id === post.id;
    const hasReplies = post.replies?.length > 0;
    const isOP = post.author.username === threadAuthorUsername;

    const handleSubmitReply = () => {
        if (!replyContent.trim()) return;
        createPostMutation.mutate({
            content: replyContent,
            parent: post.id
        });
        setReplyContent('');
        setShowReplyForm(false);
        setReplyTo(null);
    };

    if (isCollapsed) {
        return (
            <div className={`${depth > 0 ? 'pl-4 border-l-2 border-gray-700' : ''} py-1`}>
                <button
                    onClick={() => setIsCollapsed(false)}
                    className="flex items-center gap-2 group hover:bg-white/[0.03] rounded-lg py-1.5 px-2 -ml-2 transition-colors w-full text-left"
                >
                    <ChevronDown size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
                    <Avatar user={post.author} size="sm" />
                    <span className="text-sm font-medium text-gray-300">{post.author.username}</span>
                    {isOP && (
                        <span className="text-[8px] font-extrabold uppercase text-accent bg-accent/10 px-1 py-0.5 rounded tracking-wider">OP</span>
                    )}
                    <span className="text-xs text-gray-400">{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
                    {post.reply_count > 0 && (
                        <span className="text-xs text-gray-500 ml-2">
                            ({post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'} hidden)
                        </span>
                    )}
                </button>
            </div>
        );
    }

    return (
        <div className={`${depth > 0 ? 'pl-4 border-l-2 border-gray-700' : ''}`}>
            <div className="group">
                {/* Post Card - Matching Thread Style */}
                <div
                    id={`post-${post.id}`}
                    className={`relative rounded-[20px] p-4 border transition-all duration-500 ${isFocused
                        ? 'bg-accent/[0.03] border-accent/40 ring-1 ring-accent/20 shadow-[0_0_20px_rgba(139,92,246,0.1)]'
                        : isOP
                            ? 'bg-accent/[0.05] border-accent/20 hover:border-accent/30'
                            : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.08]'
                        }`}>
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-3">
                        <div className="flex items-center gap-3.5">
                            <Link to={`/profile/${post.author.username}`} className="shrink-0">
                                <Avatar user={post.author} />
                            </Link>
                            <div>
                                <div className="flex items-center gap-2">
                                    <Link to={`/profile/${post.author.username}`} className="text-[15px] font-bold text-gray-200 hover:text-white transition-colors">
                                        {post.author.username}
                                    </Link>
                                    {isOP && (
                                        <span className="text-[9px] font-extrabold uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded tracking-wider">Author</span>
                                    )}
                                </div>
                                <span className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium mt-0.5">
                                    {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                                </span>
                            </div>
                        </div>

                        <div className="absolute top-4 right-4 sm:static flex items-center gap-2">
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
                                        onClick={() => { if (window.confirm('Delete this reply?')) onDelete(post.id); }}
                                        className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                                        title="Delete Reply"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            )}
                            <button
                                onClick={() => {
                                    if (!user) return;
                                    onLike(post.id);
                                }}
                                disabled={!user}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${post.is_liked_by_user
                                    ? 'text-pink-500 hover:bg-pink-500/10'
                                    : 'text-gray-500 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <Heart size={14} className={post.is_liked_by_user ? 'fill-current' : ''} />
                                {post.like_count > 0 && post.like_count}
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div>
                        {isEditing ? (
                            <div className="space-y-3">
                                <RichTextEditor
                                    value={editPostContent}
                                    onChange={setEditPostContent}
                                    placeholder="Edit your reply..."
                                    className="mb-2"
                                />
                                <div className="flex items-center gap-2 justify-end">
                                    <button
                                        onClick={() => setEditingPostId(null)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => onEdit(post.id, editPostContent)}
                                        disabled={!editPostContent.trim()}
                                        className="btn-primary flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-lg"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <MarkdownRenderer content={post.content} className="text-[15px] opacity-90 leading-relaxed" />
                        )}
                    </div>

                    {/* Reply Actions */}
                    {!isEditing && (
                        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/[0.04]">
                            {/* Collapse thread button */}
                            {hasReplies && (
                                <button
                                    onClick={() => {
                                        setIsCollapsed(true);
                                        // Scroll to post when collapsing to keep context
                                        const element = document.getElementById(`post-${post.id}`);
                                        if (element) element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
                                    title="Collapse thread"
                                >
                                    <ChevronUp size={14} />
                                    <span className="hidden sm:inline">Hide</span>
                                </button>
                            )}

                            {depth < maxDepth && (
                                <button
                                    onClick={() => {
                                        if (!user) return;
                                        if (isReplying && showReplyForm) {
                                            setReplyTo(null);
                                            setShowReplyForm(false);
                                        } else {
                                            setReplyTo(post);
                                            setShowReplyForm(true);
                                        }
                                    }}
                                    disabled={!user}
                                    className={`flex items-center gap-1.5 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ml-auto rounded-lg px-2 py-1 ${isReplying && showReplyForm
                                        ? 'text-accent bg-accent/10'
                                        : 'text-gray-500 hover:text-accent hover:bg-accent/10'
                                        }`}
                                >
                                    <MessageCircle size={14} />
                                    {isReplying && showReplyForm ? 'Cancel Reply' : 'Reply'}
                                </button>
                            )}

                            {post.reply_count > 0 && (
                                <span className={`text-xs text-gray-500 ${depth >= maxDepth ? 'ml-auto' : ''}`}>
                                    {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Inline Reply Form */}
                    {isReplying && showReplyForm && (
                        <div className="mt-4 pt-4 border-t border-white/[0.04] animate-slide-down-fade">
                            {/* Context Header */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                    <CornerDownRight size={12} />
                                    <span>Replying to</span>
                                    <span className="font-medium text-accent-light">@{post.author.username}</span>
                                </div>
                            </div>

                            <RichTextEditor
                                value={replyContent}
                                onChange={setReplyContent}
                                placeholder={`Reply to @${post.author.username}...`}
                                className="mb-3"
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={handleSubmitReply}
                                    disabled={!replyContent.trim() || createPostMutation.isPending}
                                    className="btn-primary flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:shadow-none transition-all"
                                >
                                    {createPostMutation.isPending ? 'Posting...' : 'Post Reply'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Nested Replies */}
            {hasReplies && (
                <div className="mt-6 space-y-6">
                    {depth >= maxDepth ? (
                        <div className="pl-4 py-2 border-l-2 border-gray-800">
                            <button
                                onClick={handleContinueThread}
                                className="inline-flex items-center gap-2 text-accent-light hover:text-accent text-sm font-medium transition-colors group"
                            >
                                <CornerDownRight size={16} className="text-accent/70 group-hover:text-accent transition-colors" />
                                Continue this thread →
                            </button>
                        </div>
                    ) : (
                        post.replies.map(reply => (
                            <ThreadedPost
                                key={reply.id}
                                post={reply}
                                depth={depth + 1}
                                maxDepth={maxDepth}
                                user={user}
                                isOwner={isOwner}
                                onEdit={onEdit}
                                onDelete={onDelete}
                                onLike={onLike}
                                onReply={onReply}
                                editingPostId={editingPostId}
                                editPostContent={editPostContent}
                                setEditingPostId={setEditingPostId}
                                setEditPostContent={setEditPostContent}
                                replyTo={replyTo}
                                setReplyTo={setReplyTo}
                                createPostMutation={createPostMutation}
                                threadId={threadId}
                                focusedPostId={focusedPostId}
                                threadAuthorUsername={threadAuthorUsername}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default ThreadedPost;