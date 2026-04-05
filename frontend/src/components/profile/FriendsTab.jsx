import { useInfiniteQuery } from '@tanstack/react-query';
import { followApi } from '../../api/client';
import { Link } from 'react-router-dom';
import { UserRound, Users } from 'lucide-react';
import { useState } from 'react';

function FriendItem({ item }) {
    const user = item.user;
    const [avatarFailed, setAvatarFailed] = useState(false);
    const showAvatarImage = !!user.avatar && !avatarFailed;

    return (
        <Link
            to={`/u/${user.username}`}
            className="group relative flex flex-col items-center"
            title={user.username}
        >
            <div className="relative h-20 w-20 overflow-hidden rounded-md">
                {showAvatarImage ? (
                    <img
                        src={user.avatar}
                        alt=""
                        onError={() => setAvatarFailed(true)}
                        className="h-full w-full object-cover transition-transform"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-dark-50">
                        <UserRound className="h-10 w-10 text-slate-500" aria-hidden="true" />
                    </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="truncate px-2 text-center text-xs font-bold text-white drop-shadow-md">
                        {user.username}
                    </span>
                </div>
            </div>
        </Link>
    );
}

export default function FriendsTab({ username, isPrivate }) {
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
                    className="px-4 py-2 rounded-lg bg-dark-100 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-colors"
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
            <div className="ui-empty-state text-center py-20 text-gray-500">
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
            <div className="flex items-center justify-end mb-6">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">
                    {totalCount} {totalCount === 1 ? 'Friend' : 'Friends'}
                </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-5">
                {friends.map((item) => (
                    <FriendItem
                        key={`${item.user.username}-${item.id}`}
                        item={item}
                    />
                ))}
            </div>

            {hasNextPage && (
                <div className="flex justify-center pt-8">
                    <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="px-6 py-2.5 rounded-lg bg-dark-100 border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-accent transition-colors disabled:opacity-50"
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
