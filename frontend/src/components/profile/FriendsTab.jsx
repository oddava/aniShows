import { useInfiniteQuery } from '@tanstack/react-query';
import { followApi } from '../../api/client';
import { Link } from 'react-router-dom';
import ProfileAvatar from './ProfileAvatar';
import { friendKeys } from '../../api/queries/user';

function FriendItem({ item }) {
    const user = item.user;
    return (
        <Link
            to={`/u/${user.username}`}
            className="group flex min-w-0 flex-col items-center gap-2 text-center"
        >
            <ProfileAvatar avatar={user.avatar} username={user.username} className="h-20 w-20 text-3xl" />
            <span className="w-full truncate text-[15px] text-[var(--text-2)] group-hover:text-[var(--text-1)]">
                {user.username}
            </span>
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
        queryKey: friendKeys.list(username),
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
            <p className="text-[17px] text-[var(--text-2)]">This profile is private, so its friends are too.</p>
        );
    }

    // Early return for missing username
    if (!username) {
        return (
            <p className="py-12 text-[15px] text-[var(--text-3)]">Loading…</p>
        );
    }

    if (isLoading) {
        return (
            <p className="py-12 text-[15px] text-[var(--text-3)]">Loading…</p>
        );
    }

    if (isError) {
        return (
            <p className="text-[17px] text-[var(--text-2)]">
                Couldn’t load friends.{' '}
                <button type="button" onClick={() => refetch()} className="text-link">Try again</button>
            </p>
        );
    }

    const friends = data?.pages?.flatMap(page => page.results || page) || [];
    const totalCount = data?.pages?.[0]?.count || 0;

    if (friends.length === 0) {
        return (
            <p className=" pt-6 text-[17px] text-[var(--text-2)] max-w-xl">
                No friends yet. Friends are mutual follows: follow people you know, and when they follow back they show up here.
            </p>
        );
    }

    return (
        <div className="animate-tab-content pb-8">
            <p className="mb-6 text-[15px] text-[var(--text-2)] tabular">
                {totalCount} {totalCount === 1 ? 'friend' : 'friends'}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-5">
                {friends.map((item) => (
                    <FriendItem
                        key={`${item.user.username}-${item.id}`}
                        item={item}
                    />
                ))}
            </div>

            {hasNextPage && (
                <div className="pt-8">
                    <button
                        type="button"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="btn-secondary px-5 text-[15px]"
                    >
                        {isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    );
}
