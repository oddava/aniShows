import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Pencil, Trash2, MoreVertical } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const CommentItem = ({
  comment,
  onEdit,
  onDelete,
  isEditing,
  editText,
  setEditText,
  onSaveEdit,
  onCancelEdit
}) => {
  useAuth();
  const [showMenu, setShowMenu] = useState(false);

  // Don't render deleted comments
  if (comment.is_deleted) return null;

  const avatarUrl = comment.user?.avatar ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.user?.username}`;

  return (
    <div className="flex gap-3 py-3">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <Link to={`/profile/${comment.user?.username}`}>
          <img
            src={avatarUrl}
            alt={comment.user?.username}
            className="w-8 h-8 rounded-full object-cover border border-gray-700 hover:border-accent transition-colors"
          />
        </Link>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/profile/${comment.user?.username}`}
            className="font-medium text-sm text-gray-300 hover:text-accent transition-colors"
          >
            {comment.user?.username}
          </Link>
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
          </span>
          {(() => {
            const created = new Date(comment.created_at).getTime();
            const updated = new Date(comment.updated_at).getTime();
            const diffMs = updated - created;
            // Only show "edited" if updated more than 2 seconds after creation
            if (diffMs > 2000) {
              return <span className="text-xs text-gray-600 italic">(edited)</span>;
            }
            return null;
          })()}
        </div>

        {isEditing ? (
          <div className="mt-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-dark-50 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none text-gray-200 placeholder-gray-600"
              rows={3}
              maxLength={2000}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={onCancelEdit}
                className="px-3 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onSaveEdit}
                disabled={!editText.trim() || editText === comment.text}
                className="px-3 py-1 text-xs font-medium text-white bg-accent rounded-md hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-300 whitespace-pre-wrap">
            {comment.text}
          </p>
        )}
      </div>

      {/* Actions Menu */}
      {(comment.is_owner || comment.can_delete) && !isEditing && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 bottom-full mb-1 bg-dark-100 border border-gray-700 rounded-lg shadow-xl py-1 z-50 min-w-[120px]"
                style={{
                  right: '0',
                  transform: 'translateX(0)',
                }}>
                {comment.is_owner && (
                  <button
                    onClick={() => {
                      onEdit(comment);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                )}
                {comment.can_delete && (
                  <button
                    onClick={() => {
                      onDelete(comment.id);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CommentItem;
