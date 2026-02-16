import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logger from '../utils/logger';

const CommentForm = ({ onSubmit, placeholder = "Write a comment...", initialText = "" }) => {
  const { user } = useAuth();
  const [text, setText] = useState(initialText);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const avatarUrl = user?.avatar || 
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(text.trim());
      setText('');
    } catch (error) {
      logger.error('Failed to submit comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const charCount = text.length;
  const maxChars = 2000;

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <img
          src={avatarUrl}
          alt={user?.username}
          className="w-8 h-8 rounded-full object-cover border border-gray-700"
        />
      </div>

      {/* Input */}
      <div className="flex-1">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => {
              if (e.target.value.length <= maxChars) {
                setText(e.target.value);
              }
            }}
            placeholder={placeholder}
            className="w-full px-3 py-2 pr-10 text-sm bg-dark-50 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none text-gray-200 placeholder-gray-600"
            rows={2}
            disabled={isSubmitting}
          />
          <button
            type="submit"
            disabled={!text.trim() || isSubmitting}
            className="absolute right-2 bottom-2 p-1.5 text-gray-500 hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className={`w-4 h-4 ${isSubmitting ? 'animate-pulse' : ''}`} />
          </button>
        </div>

        <div className="flex justify-between items-center mt-1">
          <span className={`text-xs ${charCount > maxChars * 0.9 ? 'text-orange-500' : 'text-gray-600'}`}>
            {charCount}/{maxChars}
          </span>
          
          {charCount > 0 && (
            <button
              type="button"
              onClick={() => setText('')}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </form>
  );
};

export default CommentForm;
