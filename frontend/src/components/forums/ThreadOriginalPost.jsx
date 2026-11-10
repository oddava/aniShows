import { Link } from 'react-router-dom';
import { Check, Clock, Heart, MessageSquare, Pencil, Pin, Send, Trash2, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import LoadingSpinner from '../common/LoadingSpinner';
import RichTextEditor from './RichTextEditor';
import MarkdownRenderer from '../common/MarkdownRenderer';
import Avatar from './Avatar';
import MiniProfileHoverCard from '../common/MiniProfileHoverCard';

/**
 * The opening post of a thread (page 1 only): author, staff pin, owner
 * edit/delete, like, the inline edit form and the reply form.
 * `mutations` is the object from useThreadMutations.
 */
export default function ThreadOriginalPost({
    thread,
    user,
    isOwner,
    mutations,
    editingThread,
    setEditingThread,
    editThreadContent,
    setEditThreadContent,
    showReplyForm,
    setShowReplyForm,
    replyContent,
    setReplyContent,
    handleReplySubmit,
}) {
    const {
        createPostMutation,
        updateThreadMutation,
        deleteThreadMutation,
        togglePinMutation,
        threadLikeCooldownRef,
        likeThreadMutation,
        unlikeThreadMutation,
    } = mutations;

    return (
        <div className="mb-10 lg:w-[85%] mx-auto">
            <div className="bg-accent/[0.02] rounded-[20px] p-4 border border-accent/20 shadow-sm shadow-accent/5 relative">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-3">
                    <div className="flex items-center gap-3.5">
                        <MiniProfileHoverCard user={thread.author}>
                            <Link to={`/u/${thread.author.username}`} className="shrink-0">
                                <Avatar user={thread.author} />
                            </Link>
                        </MiniProfileHoverCard>
                        <div>
                            <div className="flex items-center gap-2">
                                <Link to={`/u/${thread.author.username}`} className="text-[15px] font-bold text-gray-200 hover:text-white transition-colors">
                                    {thread.author.username}
                                </Link>
                                <span className="text-[9px] font-extrabold uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded tracking-wider">Author</span>
                            </div>
                            <span className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium mt-0.5">
                                <Clock size={10} className="opacity-70" /> {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                            </span>
                        </div>
                    </div>
                    <div className="absolute top-4 right-4 sm:static flex items-center gap-2">
                        {(user?.is_staff || user?.is_superuser) && (
                            <button
                                onClick={() => {
                                    const action = thread.is_pinned ? 'unpin' : 'pin';
                                    if (window.confirm(`Are you sure you want to ${action} this thread?`)) {
                                        togglePinMutation.mutate();
                                    }
                                }}
                                disabled={togglePinMutation.isPending}
                                className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${thread.is_pinned
                                    ? 'text-yellow-500 hover:text-yellow-400'
                                    : 'text-gray-500 hover:text-white'
                                    }`}
                                title={thread.is_pinned ? 'Unpin Thread' : 'Pin Thread'}
                            >
                                <Pin size={14} />
                            </button>
                        )}
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
    );
}
