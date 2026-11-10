import { ChevronDown, ChevronUp } from 'lucide-react';
import { PostSkeleton } from './ForumSkeletons';
import ThreadedPost from './ThreadedPost';
import { forumKeys } from '../../api/queries/forums';
import buildPostTree from './buildPostTree';

/**
 * The replies under a thread: the header with count, focus and collapse
 * controls, the loading and error states, and the threaded post tree.
 * `mutations` is the object from useThreadMutations.
 */
export default function ThreadReplies({
    id,
    page,
    thread,
    user,
    isOwner,
    queryClient,
    postsData,
    postsError,
    showPostsLoading,
    focusedPostId,
    setFocusedPostId,
    setSearchParams,
    repliesCollapsed,
    setRepliesCollapsed,
    editingPostId,
    setEditingPostId,
    editPostContent,
    setEditPostContent,
    replyTo,
    setReplyTo,
    mutations,
}) {
    const {
        createPostMutation,
        likePostMutation,
        unlikePostMutation,
        updatePostMutation,
        deletePostMutation,
    } = mutations;

    return (
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
                        onClick={() => queryClient.invalidateQueries({ queryKey: forumKeys.posts(id, page) })}
                        className="mt-4 text-accent hover:underline"
                    >
                        Retry
                    </button>
                </div>
            ) : !repliesCollapsed ? (
                <div className="space-y-6">
                    {buildPostTree(postsData?.results, focusedPostId).map((post) => (
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
    );
}
