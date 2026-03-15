import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ActivityFeed from './ActivityFeed';
import ActivityHeatmap from '../ActivityHeatmap';
import HorizontalCarousel from '../common/HorizontalCarousel';
import { activityApi, listApi, favoriteApi, followApi } from '../../api/client';

function TopStatsRow({ user }) {
    if (!user) return null;

    const stats = [
        { label: 'Total Anime', value: user.anime_count || 0 },
        { label: 'Days Watched', value: user.days_watched || 0 },
        { label: 'Mean Score', value: user.mean_score || 0 },
        { label: 'Favorites', value: user.favorites_count || 0 },
        { label: 'Reviews', value: user.reviews_count || 0 },
    ];

    return (
        <div className="flex items-center justify-center gap-8 sm:gap-12 flex-wrap py-4 border-b border-gray-800/60 mb-8">
            {stats.map((stat, i) => (
                <div key={i} className="text-center">
                    <span className="text-xl sm:text-2xl font-bold text-white">{stat.value}</span>
                    <span className="block text-[11px] text-gray-500 uppercase tracking-wider mt-1">{stat.label}</span>
                </div>
            ))}
        </div>
    );
}

function CurrentlyWatchingGrid({ watchingItems }) {
    if (!watchingItems || watchingItems.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Currently Watching</h3>
                <div className="ui-surface-subtle p-8 text-center">
                    <p className="text-sm text-gray-500">Not watching anything right now</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Currently Watching</h3>
            <div className="ui-surface-subtle p-5">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {watchingItems.map((item) => {
                        const eps = item.episodes_watched || 0;
                        const total = item.anime?.episode_count || 0;
                        const progress = total > 0 ? (eps / total) * 100 : 0;

                        return (
                            <Link
                                key={item.id}
                                to={`/anime/${item.anime?.slug}`}
                                className="relative aspect-[2/3] rounded-xl overflow-hidden border border-gray-800 bg-dark-200"
                            >
                                <img
                                    src={item.anime?.cover_image_small || item.anime?.cover_image}
                                    alt={item.anime?.title}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-dark-400/80 z-20">
                                    <div
                                        className="h-full bg-accent transition-[width] duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <div className="absolute inset-x-0 bottom-0 z-10 bg-dark/85 p-2.5">
                                    <p className="mb-1 line-clamp-2 text-[10px] font-black leading-tight text-white">
                                        {item.anime?.title}
                                    </p>
                                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                                        {eps} / {total || '?'} eps
                                    </p>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function FavoritesGrid({ favoritesData }) {
    const favorites = favoritesData?.pages?.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || favoritesData?.results || favoritesData || [];

    if (!favorites || favorites.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Favorites</h3>
                <div className="ui-surface-subtle p-8 text-center">
                    <p className="text-sm text-gray-500">No favorites yet</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Favorites</h3>
            <div className="ui-surface-subtle p-5">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {favorites.map((fav) => (
                        <Link
                            key={fav.id}
                            to={`/anime/${fav.anime?.slug}`}
                            className="relative aspect-[2/3] rounded-xl overflow-hidden border border-gray-800 bg-dark-200"
                        >
                            <img
                                src={fav.anime?.cover_image_small || fav.anime?.cover_image}
                                alt={fav.anime?.title}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 z-10 bg-dark/85 p-2.5">
                                <p className="mb-1 line-clamp-2 text-[10px] font-black leading-tight text-white">
                                    {fav.anime?.title}
                                </p>
                                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-400">
                                    {fav.anime?.type || 'Anime'}
                                </p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

function FriendsGrid({ username, isPrivate, onTabChange }) {
    const { data: friendsData, isLoading } = useQuery({
        queryKey: ['friends', username],
        queryFn: () => followApi.getMutuals(username, { page_size: 12 }).then(res => res.data),
        enabled: !isPrivate && !!username,
        staleTime: 2 * 60 * 1000,
        refetchOnMount: true,
    });

    const friends = friendsData?.results || [];

    if (isPrivate || isLoading) return null;

    const MAX_DISPLAYED = 10;
    const displayedFriends = friends.slice(0, MAX_DISPLAYED);
    const totalCount = friendsData?.count || friends.length;
    const remainingCount = totalCount - MAX_DISPLAYED;

    return (
        <div className="ui-surface-subtle p-5">
            <div className="flex items-center justify-between mb-4">
                <button
                    onClick={() => onTabChange && onTabChange('friends')}
                    className="text-xs font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-wider flex items-center gap-2"
                >
                    <Users className="w-3.5 h-3.5" />
                    Friends
                </button>
                {totalCount > 0 && (
                    <span className="text-[10px] text-gray-500">{totalCount}</span>
                )}
            </div>

            {friends.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                    <p className="text-xs">No friends yet</p>
                </div>
            ) : (
                <div className="flex flex-wrap gap-3">
                    {displayedFriends.map((item) => (
                        <Link
                            key={item.user.id}
                            to={`/profile/${item.user.username}`}
                            className="flex w-14 flex-col items-center gap-1.5"
                            title={item.user.username}
                        >
                            {item.user.avatar ? (
                                <img
                                    src={item.user.avatar}
                                    alt={item.user.username}
                                    className="h-11 w-11 rounded-full border-2 border-gray-700 object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="ui-avatar-fallback h-11 w-11">
                                    <span className="text-sm font-bold text-white">
                                        {item.user.username[0].toUpperCase()}
                                    </span>
                                </div>
                            )}
                            <span className="w-full truncate text-center text-[10px] text-gray-400">
                                {item.user.username}
                            </span>
                        </Link>
                    ))}
                    {remainingCount > 0 && (
                        <button
                            onClick={() => onTabChange && onTabChange('friends')}
                            className="flex w-14 flex-col items-center gap-1.5"
                        >
                            <div className="w-11 h-11 rounded-full bg-dark-200 border-2 border-gray-700/50 flex items-center justify-center">
                                <span className="text-xs font-medium text-gray-400">+{remainingCount}</span>
                            </div>
                            <span className="text-[10px] text-gray-500 truncate w-full text-center mt-auto">View All</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function GenreOverviewSidebar({ username, isPrivate }) {
    const { data: listsData, isLoading } = useQuery({
        queryKey: ['insights-lists', username],
        queryFn: async () => {
            const statuses = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
            const results = await Promise.all(
                statuses.map(status =>
                    listApi.getAll({ status, username }).then(res => res.data.results || res.data || [])
                )
            );
            return results.flat();
        },
        enabled: !isPrivate && !!username,
        staleTime: 2 * 60 * 1000, // 2 minutes
        refetchOnMount: true,
    });

    if (isPrivate || isLoading || !listsData || listsData.length === 0) return null;

    const genreCounts = {};
    listsData.forEach(item => {
        item.anime?.genres?.forEach(genre => {
            genreCounts[genre.name] = (genreCounts[genre.name] || 0) + 1;
        });
    });

    const sortedGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

    if (sortedGenres.length === 0) return null;

    const totalCount = sortedGenres.reduce((sum, g) => sum + g.count, 0);
    const maxCount = sortedGenres[0].count;

    return (
        <div className="mb-8">
            <div className="ui-surface-subtle p-5">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Top Genres</h3>

                <div className="mb-4 pb-4 border-b border-gray-800/30">
                    <div className="flex items-baseline justify-between mb-2">
                        <span className="text-lg font-bold text-white">{sortedGenres[0].name}</span>
                        <span className="text-sm font-semibold text-accent">{sortedGenres[0].count}</span>
                    </div>
                    <div className="h-2 bg-dark-400/50 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent rounded-full transition-all duration-500"
                            style={{ width: '100%' }}
                        />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1.5">
                        {Math.round((sortedGenres[0].count / totalCount) * 100)}% of watched anime
                    </p>
                </div>

                <div className="space-y-2.5">
                    {sortedGenres.slice(1).map((genre, index) => (
                        <div
                            key={genre.name}
                            className="flex items-center gap-3 rounded-lg p-1.5 -mx-1.5"
                        >
                            <span className="text-xs text-gray-400 w-6 font-medium">{index + 2}</span>
                            <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-gray-300 font-medium">{genre.name}</span>
                                    <span className="text-[10px] text-gray-500">{genre.count}</span>
                                </div>
                                <div className="h-1 bg-dark-400/30 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gray-600 transition-[width] duration-300"
                                        style={{ width: `${(genre.count / maxCount) * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ActivityHistorySidebar({ username, isPrivate }) {
    const { data: heatmapData, isLoading, isError } = useQuery({
        queryKey: ['activity-heatmap', username],
        queryFn: () => activityApi.getHeatmap({ username }).then(res => res.data),
        enabled: !isPrivate && !!username,
        staleTime: 2 * 60 * 1000, // 2 minutes
        refetchOnMount: true,
    });

    if (isPrivate || isLoading || isError || !heatmapData) return null;

    return (
        <div className="ui-surface-subtle w-full overflow-hidden">
            <ActivityHeatmap activityData={heatmapData} />
        </div>
    );
}

export default function OverviewTab({
    displayUser,
    targetUsername,
    isPrivate,
    onTabChange
}) {
    const { data: watchingItemsData } = useQuery({
        queryKey: ['lists', targetUsername, 'Watching'],
        queryFn: () => listApi.getAll({ status: 'Watching', username: targetUsername }).then(res => res.data.results || res.data || []),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000, // 1 minute
        refetchOnMount: true,
    });

    const { data: favsData } = useQuery({
        queryKey: ['favorites-overview', targetUsername],
        queryFn: () => favoriteApi.getAll({ username: targetUsername, page: 1, page_size: 100 }).then(res => res.data),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000, // 1 minute
        refetchOnMount: true,
    });

    const watchingItems = watchingItemsData || [];
    const favoritesData = favsData || [];

    return (
        <div className="animate-tab-content pb-8 overview-tab">
            <TopStatsRow user={displayUser} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                <div className="lg:col-span-5 space-y-8">
                    {displayUser?.bio ? (
                        <div className="ui-surface-subtle p-6">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">About</h3>
                            <div className="text-sm text-gray-300 leading-relaxed max-h-[400px] overflow-y-auto custom-scrollbar pr-3">
                                <MarkdownRenderer content={displayUser.bio} />
                            </div>
                        </div>
                    ) : null}

                    {displayUser?.social_links && displayUser.social_links.length > 0 ? (
                        <div>
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Links</h3>
                            <div className="flex flex-wrap gap-2">
                                {displayUser.social_links.map((link, i) => (
                                    <a
                                        key={i}
                                        href={link.value}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-4 py-2 bg-dark-100 hover:bg-dark-50 text-xs text-gray-300 hover:text-white rounded-lg border border-gray-800/60 transition-colors"
                                    >
                                        {link.platform}
                                    </a>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <FriendsGrid username={targetUsername} isPrivate={isPrivate} onTabChange={onTabChange} />

                    <ActivityHistorySidebar username={targetUsername} isPrivate={isPrivate} />

                    <GenreOverviewSidebar username={targetUsername} isPrivate={isPrivate} />
                </div>

                <div className="lg:col-span-7 min-h-[400px]">
                    <FavoritesGrid favoritesData={favoritesData} />

                    <CurrentlyWatchingGrid watchingItems={watchingItems} />

                    <div className="mt-8 ui-surface-subtle p-5">
                        <div className="mb-5 flex items-center justify-between gap-4">
                            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Watching Activity</h3>
                            <button
                                type="button"
                                onClick={() => onTabChange && onTabChange('activity')}
                                className="rounded-lg border border-gray-700 bg-dark-100 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:border-accent/50 hover:text-white"
                            >
                                View Full Feed
                            </button>
                        </div>
                        <ActivityFeed username={targetUsername} isPrivate={isPrivate} compact />
                    </div>
                </div>
            </div>
        </div>
    );
}
