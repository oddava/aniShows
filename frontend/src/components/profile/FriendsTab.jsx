import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { followApi } from '../../api/client';
import { Link } from 'react-router-dom';
import { useState, useCallback, useRef } from 'react';
import { Users, UserMinus, Loader2, Sparkles, UserPlus, UserCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

function FriendItem({ item, onToggle }) {
    const { user: currentUser } = useAuth();
    const user = item.user;
    const [isPending, setIsPending] = useState(false);

    // Default to true since they are mutuals, but allow optimistic updates to change it
    const [isFollowing, setIsFollowing] = useState(true);

    // If the logged-in user is viewing their own profile, they can unfollow their friends.
    // If viewing someone else's profile, the button state would depend on whether 
    // the current user follows them (which is what `item.is_following` represents for the auth user)
    const currentIsFollowing = item.is_following !== undefined ? item.is_following : isFollowing;
    const currentIsFollower = item.is_follower !== undefined ? item.is_follower : true;

    const showFollowButton = !!currentUser && currentUser.username !== user.username;

    const isFriends = currentIsFollowing && currentIsFollower;
    const isFollowBack = !currentIsFollowing && currentIsFollower;

    const handleFollowToggle = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isPending) return;

        const previousState = currentIsFollowing;
        const newState = !previousState;
        setIsFollowing(newState);
        setIsPending(true);

        try {
            const response = await followApi.toggle(user.username);
            const serverIsFollowing = response.data?.is_following ?? newState;
            if (serverIsFollowing !== newState) {
                setIsFollowing(serverIsFollowing);
            }
            if (onToggle) onToggle(user.username, serverIsFollowing);
        } catch {
            setIsFollowing(previousState);
        } finally {
            setIsPending(false);
        }
    };

    const getButtonIcon = () => {
        if (isPending) return <Loader2 className="w-4 h-4 animate-spin" />;
        if (isFriends) return <Users className="w-4 h-4" />;
        if (currentIsFollowing) return <UserMinus className="w-4 h-4" />;
        if (isFollowBack) return <UserCheck className="w-4 h-4" />;
        return <UserPlus className="w-4 h-4" />;
    };

    const getButtonLabel = () => {
        if (isFriends) return 'Friends';
        if (currentIsFollowing) return 'Following';
        if (isFollowBack) return 'Follow Back';
        return 'Follow';
    };

    const getButtonStyles = () => {
        if (isFriends) {
            return 'bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50';
        }
        if (currentIsFollowing) {
            return 'bg-gray-700/50 text-gray-300 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 border border-gray-600';
        }
        if (isFollowBack) {
            return 'bg-accent/80 text-white hover:bg-accent border border-accent';
        }
        return 'bg-accent text-white hover:bg-accent/80';
    };

    return (
        <Link
            to={`/profile/${user.username}`}
            className="group flex flex-col items-center gap-2"
            title={user.username}
        >
            {user.avatar ? (
                <img
                    src={user.avatar}
                    alt={user.username}
                    className="w-20 h-20 rounded-md object-cover border border-gray-700/60 group-hover:border-accent/60 transition-colors"
                />
            ) : (
                <div className="w-20 h-20 rounded-md bg-gradient-to-br from-accent/30 to-pink-500/30 flex items-center justify-center border border-gray-700/60 group-hover:border-accent/60 transition-colors">
                    <span className="text-xl font-bold text-white">
                        {user.username[0].toUpperCase()}
                    </span>
                </div>
            )}
            <span className="text-xs font-medium text-gray-400 group-hover:text-white transition-colors max-w-[88px] truncate">
                {user.username}
            </span>
        </Link>
    );
}

export default function FriendsTab({ username, isPrivate }) {
    const queryClient = useQueryClient();

    // We keep track of follow mutations locally to invalidate when unmounting if needed, 
    // or just rely on query invalidations
    const didMutateRef = useRef(false);

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError,
        refetch,
    } = useInfiniteQuery({
        queryKey: ['friends-infinite', username],
        queryFn: async ({ pageParam }) => {
            const res = await followApi.getMutuals(username, { page: pageParam, page_size: 20 });
            return res.data || { results: [], count: 0, next: null };
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage?.next) {
                try {
                    const url = new URL(lastPage.next);
                    const pageParam = Number(url.searchParams.get('page'));
                    return Number.isFinite(pageParam) ? pageParam : undefined;
                } catch {
                    return undefined;
                }
            }
            return undefined;
        },
        staleTime: 2 * 60 * 1000,
        enabled: !!username && !isPrivate,
    });

    const handleFollowToggle = useCallback((targetUsername, newIsFollowing) => {
        didMutateRef.current = true;
    }, []);

    // Early return for private profiles
    if (isPrivate) {
        return (
            <div className="text-center py-16 text-gray-400 text-sm">
                Friends are not available for private profiles.
            </div>
        );
    }

    // Early return for missing username
    if (!username) {
        return (
            <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="text-center py-16 text-gray-500">
                <p className="text-sm mb-3">Failed to load friends.</p>
                <button
                    onClick={() => refetch()}
                    className="px-4 py-2 rounded-lg bg-dark-100 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-all"
                >
                    Try Again
                </button>
            </div>
        );
    }

    const friends = data?.pages?.flatMap(page => page.results || page) || [];
    const totalCount = data?.pages?.[0]?.count || 0;

    if (friends.length === 0) {
        return (
            <div className="text-center py-20 text-gray-500 bg-dark-100/30 backdrop-blur-sm rounded-xl border border-gray-800/50">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-40 text-gray-400" />
                <p className="text-base font-medium text-gray-300">No friends yet</p>
                <p className="text-sm mt-1 text-gray-500 max-w-sm mx-auto">
                    Friends are mutual follows. Follow people you know, and when they follow you back, they will appear here.
                </p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content pb-8">
            <div className="flex items-center justify-end mb-6 border-b border-gray-800/60 pb-4">
                <span className="text-sm text-gray-400 font-medium">
                    {totalCount} {totalCount === 1 ? 'Friend' : 'Friends'}
                </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-5">
                {friends.map((item) => (
                    <FriendItem
                        key={`${item.user.username}-${item.id}`}
                        item={item}
                        onToggle={handleFollowToggle}
                    />
                ))}
            </div>

            {hasNextPage && (
                <div className="flex justify-center pt-8">
                    <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="px-6 py-2.5 rounded-lg bg-dark-100 border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-accent transition-all disabled:opacity-50"
                    >
                        {isFetchingNextPage ? (
                            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
                        ) : (
                            'Load More'
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
