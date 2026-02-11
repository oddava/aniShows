import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { reviewApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import CommentItem from './CommentItem';
import CommentForm from './CommentForm';

const ReviewComments = ({ reviewId, commentCount }) => {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editText, setEditText] = useState('');

  // Fetch comments
  const { 
    data: commentsData, 
    isLoading, 
    error 
  } = useQuery({
    queryKey: ['reviewComments', reviewId, page],
    queryFn: () => reviewApi.getComments(reviewId, page),
    enabled: isExpanded,
    staleTime: 1000 * 60, // 1 minute
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: (text) => reviewApi.addComment(reviewId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewComments', reviewId] });
      // Also invalidate review to update comment count
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  // Update comment mutation
  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, text }) => 
      reviewApi.updateComment(reviewId, commentId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewComments', reviewId] });
      setEditingCommentId(null);
      setEditText('');
    },
  });

  // Delete comment mutation
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId) => reviewApi.deleteComment(reviewId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewComments', reviewId] });
      // Also invalidate review to update comment count
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  const handleEdit = useCallback((comment) => {
    setEditingCommentId(comment.id);
    setEditText(comment.text);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingCommentId(null);
    setEditText('');
  }, []);

  const handleSaveEdit = useCallback((commentId) => {
    if (!editText.trim()) return;
    updateCommentMutation.mutate({ commentId, text: editText.trim() });
  }, [editText, updateCommentMutation]);

  const handleDelete = useCallback((commentId) => {
    if (window.confirm('Are you sure you want to delete this comment?')) {
      deleteCommentMutation.mutate(commentId);
    }
  }, [deleteCommentMutation]);

  const handleAddComment = useCallback(async (text) => {
    await addCommentMutation.mutateAsync(text);
  }, [addCommentMutation]);

  const comments = commentsData?.data?.results || [];
  const hasMore = commentsData?.data?.next || false;
  const totalCount = commentsData?.data?.count || commentCount || 0;

  return (
    <div className="mt-4 border-t border-gray-800/50">
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 py-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        <MessageSquare className="w-4 h-4" />
        <span>
          {totalCount > 0 
            ? `${totalCount} comment${totalCount !== 1 ? 's' : ''}` 
            : 'Comments'
          }
        </span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Comments Section */}
      {isExpanded && (
        <div className="pb-4">
          {/* Add Comment Form */}
          {isAuthenticated && (
            <div className="mb-4 pb-4 border-b border-gray-800/50">
              <CommentForm 
                onSubmit={handleAddComment}
                placeholder="Add a comment..."
              />
            </div>
          )}

          {/* Comments List */}
          {isLoading ? (
            <div className="py-4 text-center text-gray-500 text-sm">
              Loading comments...
            </div>
          ) : error ? (
            <div className="py-4 text-center text-red-400 text-sm">
              Failed to load comments
            </div>
          ) : comments.length > 0 ? (
            <>
              <div className="divide-y divide-gray-800/50">
                {comments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    isEditing={editingCommentId === comment.id}
                    editText={editText}
                    setEditText={setEditText}
                    onSaveEdit={() => handleSaveEdit(comment.id)}
                    onCancelEdit={handleCancelEdit}
                  />
                ))}
              </div>

              {/* Load More */}
              {hasMore && (
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="w-full mt-4 py-2 text-sm text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-lg transition-colors"
                >
                  Load more comments
                </button>
              )}
            </>
          ) : (
            <div className="py-4 text-center text-gray-500 text-sm">
              {isAuthenticated 
                ? 'No comments yet. Be the first to comment!' 
                : 'No comments yet.'
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReviewComments;
