import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followApi } from '../api/client';
import { UserPlus, UserMinus, UserCheck, Users, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logger from '../utils/logger';

/**
 * Follow button with support for different relationship states:
 * - Following: You follow them
 * - Follower: They follow you (but you don't follow back)
 * - Friends: Mutual follow (follow each other)
 * - None: No relationship
 */
export default function FollowButton({
    username,
    initialIsFollowing = false,
    initialIsFollower = false,
    onFollowChange,
    onUnfollow,
    onSuccess,
    variant = 'default', // 'default' | 'compact'
    className = ''
}) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [isFollowing, setIsFollowing] = useState(initialIsFollowing);

    // Sync state when props change
    useEffect(() => {
        setIsFollowing(initialIsFollowing);
    }, [initialIsFollowing]);

    const toggleMutation = useMutation({
        mutationFn: () => followApi.toggle(username),
        onMutate: async () => {
            // Cancel any outgoing refetches to avoid overwriting optimistic update
            await queryClient.cancelQueries({ queryKey: ['user', username] });
            await queryClient.cancelQueries({ queryKey: ['profile', username] });
            await queryClient.cancelQueries({ queryKey: ['follows'] });

            // Snapshot previous values
            const previousTargetProfile = queryClient.getQueryData(['profile', username]);
            const previousTargetUser = queryClient.getQueryData(['user', username]);
            const previousMyProfile = queryClient.getQueryData(['profile', 'me']);
            const previousMyUser = queryClient.getQueryData(['user', 'me']);

            // Calculate new values
            const newIsFollowing = !isFollowing;
            const followerDelta = newIsFollowing ? 1 : -1;

            // Optimistically update target user's profile (followers_count)
            if (previousTargetProfile) {
                const updatedTargetProfile = {
                    ...previousTargetProfile,
                    followers_count: (previousTargetProfile.followers_count || 0) + followerDelta,
                    is_following: newIsFollowing
                };
                queryClient.setQueryData(['profile', username], updatedTargetProfile);
            }

            // Optimistically update target user's data
            if (previousTargetUser) {
                const updatedTargetUser = {
                    ...previousTargetUser,
                    followers_count: (previousTargetUser.followers_count || 0) + followerDelta,
                    is_following: newIsFollowing
                };
                queryClient.setQueryData(['user', username], updatedTargetUser);
            }

            // Optimistically update current user's profile (following_count)
            if (previousMyProfile) {
                const updatedMyProfile = {
                    ...previousMyProfile,
                    following_count: (previousMyProfile.following_count || 0) + followerDelta
                };
                queryClient.setQueryData(['profile', 'me'], updatedMyProfile);
            }

            // Optimistically update current user's data
            if (previousMyUser) {
                const updatedMyUser = {
                    ...previousMyUser,
                    following_count: (previousMyUser.following_count || 0) + followerDelta
                };
                queryClient.setQueryData(['user', 'me'], updatedMyUser);
            }

            // Optimistically update local state
            setIsFollowing(newIsFollowing);

            // Return context for rollback
            return {
                previousTargetProfile,
                previousTargetUser,
                previousMyProfile,
                previousMyUser,
                previousIsFollowing: isFollowing
            };
        },
        onSuccess: (response, variables, context) => {
            const newIsFollowing = response.data?.is_following ?? !context.previousIsFollowing;
            const followerCount = response.data?.followers_count;
            
            // Update with server response (in case it differs from optimistic)
            setIsFollowing(newIsFollowing);

            // Update caches with exact server data
            if (followerCount !== undefined) {
                queryClient.setQueryData(['profile', username], (old) => 
                    old ? { ...old, followers_count: followerCount, is_following: newIsFollowing } : old
                );
                queryClient.setQueryData(['user', username], (old) => 
                    old ? { ...old, followers_count: followerCount, is_following: newIsFollowing } : old
                );
            }

            // Only invalidate follows list query if we're NOT in the modal
            if (!onUnfollow) {
                queryClient.invalidateQueries({ queryKey: ['follows'] });
            }

            if (onFollowChange) {
                onFollowChange(newIsFollowing, followerCount);
            }

            // Call onSuccess callback for parent component refetch
            if (onSuccess) {
                onSuccess();
            }

            // Check if this was an unfollow action
            if (!newIsFollowing && onUnfollow) {
                onUnfollow(username);
            }
        },
        onError: (error, variables, context) => {
            // Rollback optimistic updates
            if (context?.previousTargetProfile) {
                queryClient.setQueryData(['profile', username], context.previousTargetProfile);
            }
            if (context?.previousTargetUser) {
                queryClient.setQueryData(['user', username], context.previousTargetUser);
            }
            if (context?.previousMyProfile) {
                queryClient.setQueryData(['profile', 'me'], context.previousMyProfile);
            }
            if (context?.previousMyUser) {
                queryClient.setQueryData(['user', 'me'], context.previousMyUser);
            }
            
            // Revert local state
            if (context?.previousIsFollowing !== undefined) {
                setIsFollowing(context.previousIsFollowing);
            }
            
            logger.error('Follow error:', error);
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

    // Determine button state
    const isFriends = isFollowing && initialIsFollower;
    const isFollowBack = !isFollowing && initialIsFollower;

    // Get button content based on state
    const getButtonContent = () => {
        if (toggleMutation.isPending) {
            return <Loader2 className="w-4 h-4 animate-spin" />;
        }

        if (isFriends) {
            return (
                <>
                    <Users className="w-4 h-4" />
                    <span className="hidden sm:inline">Friends</span>
                </>
            );
        }

        if (isFollowing) {
            return (
                <>
                    <UserMinus className="w-4 h-4" />
                    <span className="hidden sm:inline">Following</span>
                </>
            );
        }

        if (isFollowBack) {
            return (
                <>
                    <UserCheck className="w-4 h-4" />
                    <span className="hidden sm:inline">Follow Back</span>
                </>
            );
        }

        return (
            <>
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Follow</span>
            </>
        );
    };

    // Get button styles based on state
    const getButtonStyles = () => {
        if (isFriends) {
            return 'bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50';
        }

        if (isFollowing) {
            return 'bg-gray-700/50 text-gray-300 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 border border-gray-600';
        }

        if (isFollowBack) {
            return 'bg-accent/80 text-white hover:bg-accent border border-accent';
        }

        return 'bg-accent text-white hover:bg-accent/80';
    };

    const title = isFriends 
        ? 'Friends (click to unfollow)'
        : isFollowing 
            ? 'Unfollow'
            : isFollowBack
                ? 'Follow Back'
                : 'Follow';

    if (variant === 'compact') {
        return (
            <button
                onClick={handleClick}
                disabled={toggleMutation.isPending}
                className={`
                    flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium
                    transition-all duration-200
                    ${getButtonStyles()}
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${className}
                `}
                title={title}
            >
                {getButtonContent()}
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
                ${getButtonStyles()}
                disabled:opacity-50 disabled:cursor-not-allowed
                ${className}
            `}
            title={title}
        >
            {getButtonContent()}
        </button>
    );
}
