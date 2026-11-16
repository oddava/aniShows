import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Pencil, Trash2, ChevronDown, ChevronUp, CornerDownRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import Avatar from './Avatar';
import MiniProfileHoverCard from '../common/MiniProfileHoverCard';
import MarkdownRenderer from '../common/MarkdownRenderer';
import RichTextEditor from './RichTextEditor';
import EditedMarker from './EditedMarker';
import ModerateMenu, { promptRemovalReason } from './ModerateMenu';

/** Absolute depth past which the server refuses replies (Post.MAX_DEPTH). */
export const MAX_REPLY_DEPTH = 10;

/**
 * Whether Reply is offered on a post: the server's `can_reply` when present,
 * else the absolute `depth` (from the API) below the cap and an open thread
 * (staff may still reply in locked threads).
 */
export const canReplyToPost = (post, { visualDepth = 0, threadLocked = false, isStaff = false } = {}) => {
    if (post.is_removed) return false;
    if (typeof post.can_reply === 'boolean') return post.can_reply;
    const depth = typeof post.depth === 'number' ? post.depth : visualDepth;
    return depth < MAX_REPLY_DEPTH && (!threadLocked || isStaff);
};

export const removedPlaceholder = (post) => (
    post.removal === 'author' ? '[deleted]' : 'This reply was removed'
);

const likeLabel = (count) => `Like reply, ${count} ${count === 1 ? 'like' : 'likes'}`;

const ThreadedPost = ({
    post,
    depth = 0,
    maxDepth = 8,
    user,
    isOwner,
    isStaff = false,
    threadLocked = false,
    onEdit,
    onDelete,
    onLike,
    onReply,
    onRemove,
    onRestore,
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
    const isFocused = focusedPostId != null && Number(focusedPostId) === post.id;

    // "Continue this thread" / "More replies": focus this post (its subtree is fetched with ?root=)
    const handleContinueThread = (e) => {
        e.preventDefault();
        navigate(`/forums/thread/${threadId}?post=${post.id}`, { replace: false });
    };

    const author = post.author || null;
    const username = author?.username;
    const isEditing = editingPostId === post.id;
    const isReplying = replyTo?.id === post.id;
    const hasReplies = post.replies?.length > 0;
    const hasHiddenReplies = Boolean(post.hasHiddenReplies ?? post.has_hidden_replies);
    const isOP = Boolean(username) && username === threadAuthorUsername;
    const isRemoved = Boolean(post.is_removed);
    // Non-staff get no content/author for removed posts; show the placeholder in its place
    const showPlaceholder = isRemoved && (!isStaff || !author);
    const canReply = canReplyToPost(post, { visualDepth: depth, threadLocked, isStaff });
    const canEdit = Boolean(username) && !isRemoved && isOwner(username);
    const likeCount = post.like_count || 0;

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

    const moderateActions = isStaff ? [
        isRemoved
            ? {
                label: 'Restore',
                onSelect: () => {
                    if (window.confirm('Restore this reply?')) onRestore?.(post.id);
                },
            }
            : {
                label: 'Remove',
                danger: true,
                onSelect: () => {
                    const reason = promptRemovalReason('reply');
                    if (reason !== null) onRemove?.(post.id, reason);
                },
            },
    ] : [];

    const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

    if (isCollapsed) {
        return (
            <div className={`${depth > 0 ? 'pl-4 border-l-2 border-gray-700' : ''} py-1`}>
                <button
                    onClick={() => setIsCollapsed(false)}
                    aria-expanded={false}
                    className="flex items-center gap-2 group hover:bg-white/[0.03] rounded-lg py-1.5 px-2 -ml-2 transition-colors w-full text-left"
                >
                    <ChevronDown size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
                    {showPlaceholder ? (
                        <span className="text-sm italic text-gray-500">{removedPlaceholder(post)}</span>
                    ) : (
                        <>
                            <Avatar user={author} size="sm" />
                            <span className="text-sm font-medium text-gray-300">{username}</span>
                        </>
                    )}
                    {isOP && !showPlaceholder && (
                        <span className="text-[8px] font-extrabold uppercase text-accent bg-accent/10 px-1 py-0.5 rounded tracking-wider">OP</span>
                    )}
                    <span className="text-xs text-gray-400">{timeAgo}</span>
                    {post.reply_count > 0 && (
                        <span className="text-xs text-gray-500 ml-2">
                            ({post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'} hidden)
                        </span>
                    )}
                </button>
            </div>
        );
    }

    const collapseButton = hasReplies && (
        <button
            onClick={() => {
                setIsCollapsed(true);
                // Scroll to post when collapsing to keep context
                const element = document.getElementById(`post-${post.id}`);
                if (element) element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
            title="Collapse thread"
            aria-label="Hide replies"
        >
            <ChevronUp size={14} />
            <span className="hidden sm:inline">Hide</span>
        </button>
    );

    return (
        <div className={`${depth > 0 ? 'pl-4 border-l-2 border-gray-700' : ''}`}>
            <div className="group">
                {showPlaceholder ? (
                    <div
                        id={`post-${post.id}`}
                        className={`relative rounded-[20px] px-4 py-3 border ${isFocused
                            ? 'bg-accent/[0.03] border-accent/40 ring-1 ring-accent/20'
                            : 'bg-white/[0.02] border-white/[0.05]'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <p className="text-sm italic text-gray-500">{removedPlaceholder(post)}</p>
                            <span className="text-[11px] text-gray-500 font-medium">{timeAgo}</span>
                            <div className="ml-auto flex items-center gap-3">
                                {collapseButton}
                                {isStaff && <ModerateMenu actions={moderateActions} />}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div
                        id={`post-${post.id}`}
                        className={`relative rounded-[20px] p-4 border transition-all duration-500 ${isFocused
                            ? 'bg-accent/[0.03] border-accent/40 ring-1 ring-accent/20 shadow-[0_0_20px_rgba(117,105,141,0.08)]'
                            : isOP
                                ? 'bg-accent/[0.05] border-accent/20 hover:border-accent/30'
                                : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.08]'
                            }`}>
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-3">
                            <div className="flex items-center gap-3.5">
                                <MiniProfileHoverCard user={author}>
                                    <Link to={`/u/${username}`} className="shrink-0">
                                        <Avatar user={author} />
                                    </Link>
                                </MiniProfileHoverCard>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Link to={`/u/${username}`} className="text-[15px] font-bold text-gray-200 hover:text-white transition-colors">
                                            {username}
                                        </Link>
                                        {isOP && (
                                            <span className="text-[9px] font-extrabold uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded tracking-wider">Author</span>
                                        )}
                                    </div>
                                    <span className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium mt-0.5">
                                        {timeAgo}
                                        <EditedMarker editedAt={post.edited_at} />
                                    </span>
                                </div>
                            </div>

                            <div className="absolute top-4 right-4 sm:static flex items-center gap-2">
                                {canEdit && (
                                    <div className="flex items-center gap-1 mr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => { setEditingPostId(post.id); setEditPostContent(post.content); }}
                                            className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                                            title="Edit Reply"
                                            aria-label={`Edit reply by ${username}`}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            onClick={() => { if (window.confirm('Delete this reply?')) onDelete(post.id); }}
                                            className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                                            title="Delete Reply"
                                            aria-label="Delete reply"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                )}
                                {isStaff && <ModerateMenu actions={moderateActions} />}
                                {!isRemoved && (
                                    <button
                                        onClick={() => {
                                            if (!user) return;
                                            onLike(post.id, Boolean(post.is_liked_by_user));
                                        }}
                                        disabled={!user}
                                        aria-label={user ? likeLabel(likeCount) : 'Sign in to like'}
                                        aria-pressed={user ? Boolean(post.is_liked_by_user) : undefined}
                                        title={user ? undefined : 'Sign in to like'}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${post.is_liked_by_user
                                            ? 'text-pink-500 hover:bg-pink-500/10'
                                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                                            }`}
                                    >
                                        <Heart size={14} className={post.is_liked_by_user ? 'fill-current' : ''} />
                                        {likeCount > 0 && likeCount}
                                    </button>
                                )}
                            </div>
                        </div>

                        {isRemoved && (
                            <p className="mb-3 text-xs text-red-400/80">
                                {post.removal === 'author' ? 'Deleted by the author' : 'Removed by a moderator'}
                                {post.removal_reason ? `: ${post.removal_reason}` : ''}
                                {' '}(only staff can see this content)
                            </p>
                        )}

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
                                <MarkdownRenderer mode="markdown" content={post.content} className="text-[15px] opacity-90 leading-relaxed" />
                            )}
                        </div>

                        {/* Reply Actions */}
                        {!isEditing && (collapseButton || canReply || post.reply_count > 0) && (
                            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/[0.04]">
                                {collapseButton}

                                {canReply && (
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
                                        title={user ? undefined : 'Sign in to reply'}
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
                                    <span className={`text-xs text-gray-500 ${!canReply ? 'ml-auto' : ''}`}>
                                        {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Inline Reply Form */}
                        {isReplying && showReplyForm && canReply && (
                            <div className="mt-4 pt-4 border-t border-white/[0.04] animate-slide-down-fade">
                                {/* Context Header */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2 text-xs text-gray-400">
                                        <CornerDownRight size={12} />
                                        <span>Replying to</span>
                                        <span className="font-medium text-accent-light">@{username}</span>
                                    </div>
                                </div>

                                <RichTextEditor
                                    value={replyContent}
                                    onChange={setReplyContent}
                                    placeholder={`Reply to @${username}...`}
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
                )}
            </div>

            {/* Nested Replies */}
            {(hasReplies || (hasHiddenReplies && !isFocused)) && (
                <div className="mt-6 space-y-6">
                    {depth >= maxDepth && !isFocused ? (
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
                        <>
                            {post.replies?.map(reply => (
                                <ThreadedPost
                                    key={reply.id}
                                    post={reply}
                                    depth={depth + 1}
                                    maxDepth={maxDepth}
                                    user={user}
                                    isOwner={isOwner}
                                    isStaff={isStaff}
                                    threadLocked={threadLocked}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                    onLike={onLike}
                                    onReply={onReply}
                                    onRemove={onRemove}
                                    onRestore={onRestore}
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
                            ))}
                            {hasHiddenReplies && !isFocused && (
                                <div className="pl-4 py-2 border-l-2 border-gray-800">
                                    <button
                                        onClick={handleContinueThread}
                                        className="inline-flex items-center gap-2 text-accent-light hover:text-accent text-sm font-medium transition-colors group"
                                    >
                                        <CornerDownRight size={16} className="text-accent/70 group-hover:text-accent transition-colors" />
                                        {hasReplies ? 'More replies →' : 'Continue this thread →'}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default ThreadedPost;
