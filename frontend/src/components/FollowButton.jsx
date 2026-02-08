import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followApi } from '../api/client';
import { UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function FollowButton({
    username,
    initialIsFollowing = false,
    onFollowChange,
    variant = 'default', // 'default' | 'compact'
    className = ''
}) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [isFollowing, setIsFollowing] = useState(initialIsFollowing);

    // Sync state when initialIsFollowing prop changes (e.g., after page refresh)
    useEffect(() => {
        setIsFollowing(initialIsFollowing);
    }, [initialIsFollowing]);

    const toggleMutation = useMutation({
        mutationFn: () => followApi.toggle(username),
        onMutate: async () => {
            // Optimistic update
            setIsFollowing(prev => !prev);
        },
        onSuccess: (response) => {
            const newIsFollowing = response.data?.is_following ?? !isFollowing;
            setIsFollowing(newIsFollowing);

            // Invalidate profile queries to update follower counts
            queryClient.invalidateQueries({ queryKey: ['user', username] });
            queryClient.invalidateQueries({ queryKey: ['profile', username] });

            if (onFollowChange) {
                onFollowChange(newIsFollowing, response.data?.followers_count);
            }
        },
        onError: (error) => {
            // Revert on error
            setIsFollowing(prev => !prev);
            console.error('Follow error:', error);
            // Log more details about the error
            if (error.response) {
                console.error('Error response:', error.response.status, error.response.data);
            }
        }
    });

    // Don't show button for own profile or if not logged in
    if (!user || user.username === username) {
        return null;
    }

    const handleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMutation.mutate();
    };

    if (variant === 'compact') {
        return (
            <button
                onClick={handleClick}
                disabled={toggleMutation.isPending}
                className={`
                    flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium
                    transition-all duration-200
                    ${isFollowing
                        ? 'bg-gray-700/50 text-gray-300 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 border border-gray-600'
                        : 'bg-accent text-white hover:bg-accent/80'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${className}
                `}
                title={isFollowing ? 'Unfollow' : 'Follow'}
            >
                {toggleMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : isFollowing ? (
                    <>
                        <UserMinus className="w-4 h-4" />
                        <span className="hidden sm:inline">Following</span>
                    </>
                ) : (
                    <>
                        <UserPlus className="w-4 h-4" />
                        <span className="hidden sm:inline">Follow</span>
                    </>
                )}
            </button>
        );
    }

    return (
        <button
            onClick={handleClick}
            disabled={toggleMutation.isPending}
            className={`
                flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-medium
                transition-all duration-200
                ${isFollowing
                    ? 'bg-gray-700/50 text-gray-300 hover:bg-red-500/20 hover:text-red-400 border border-gray-600 hover:border-red-500/50'
                    : 'bg-accent text-white hover:bg-accent/80 shadow-lg shadow-accent/25'
                }
                disabled:opacity-50 disabled:cursor-not-allowed
                ${className}
            `}
        >
            {toggleMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
            ) : isFollowing ? (
                <>
                    <UserMinus className="w-5 h-5" />
                    <span>Following</span>
                </>
            ) : (
                <>
                    <UserPlus className="w-5 h-5" />
                    <span>Follow</span>
                </>
            )}
        </button>
    );
}
