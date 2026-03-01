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
                <h3 className="text-sm font-bold text-white mb-4">Currently Watching</h3>
                <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-8 border border-gray-800/30 text-center">
                    <p className="text-sm text-gray-500">Not watching anything right now</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="text-sm font-bold text-white mb-4">Currently Watching</h3>
            <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-5 border border-gray-800/30">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {watchingItems.map((item) => {
                        const eps = item.episodes_watched || 0;
                        const total = item.anime?.episode_count || 0;
                        const progress = total > 0 ? (eps / total) * 100 : 0;

                        return (
                            <Link
                                key={item.id}
                                to={`/anime/${item.anime?.slug}`}
                                className="group relative aspect-[2/3] rounded-xl overflow-hidden bg-dark-200 transition-all duration-500"
                            >
                                <img
                                    src={item.anime?.cover_image_small || item.anime?.cover_image}
                                    alt={item.anime?.title}
                                    className="w-full h-full object-cover transition-transform duration-700"
                                />
                                {/* Bottom Progress bar with glow */}
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-dark-400/80 z-20">
                                    <div
                                        className="h-full bg-accent transition-all duration-300 shadow-[0_0_8px_rgba(139,92,246,0.6)]"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <div className="absolute inset-0 bg-gradient-to-t from-dark/95 via-dark/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-2.5 z-10">
                                    <p className="text-[10px] font-black text-white leading-tight line-clamp-2 mb-1 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75">
                                        {item.anime?.title}
                                    </p>
                                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-100">
                                        {eps} / {total || '?'} eps
                                    </p>
                                </div>
                                {/* Shine effect */}
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
                                    <div className="absolute -inset-[100%] translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12" />
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
                <h3 className="text-sm font-bold text-white mb-4">Favorites</h3>
                <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-8 border border-gray-800/30 text-center">
                    <p className="text-sm text-gray-500">No favorites yet</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="text-sm font-bold text-white mb-4">Favorites</h3>
            <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-5 border border-gray-800/30">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {favorites.map((fav) => (
                        <Link
                            key={fav.id}
                            to={`/anime/${fav.anime?.slug}`}
                            className="group relative aspect-[2/3] rounded-xl overflow-hidden bg-dark-200 border border-white/5 transition-all duration-500"
                        >
                            <img
                                src={fav.anime?.cover_image_small || fav.anime?.cover_image}
                                alt={fav.anime?.title}
                                className="w-full h-full object-cover transition-transform duration-700"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-dark/95 via-dark/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-2.5 z-10">
                                <p className="text-[10px] font-black text-white leading-tight line-clamp-2 mb-1 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75">
                                    {fav.anime?.title}
                                </p>
                                <p className="text-[9px] text-gray-400 uppercase font-bold tracking-[0.1em] transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-100">
                                    {fav.anime?.type || 'Anime'}
                                </p>
                            </div>
                            {/* Shine effect */}
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
                                <div className="absolute -inset-[100%] translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12" />
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
        <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-5 border border-gray-800/30">
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
                            className="group flex flex-col items-center gap-1.5 w-14"
                            title={item.user.username}
                        >
                            {item.user.avatar ? (
                                <img
                                    src={item.user.avatar}
                                    alt={item.user.username}
                                    className="w-11 h-11 rounded-full object-cover border-2 border-gray-700/50 group-hover:border-accent/50 transition-colors"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-accent/30 to-pink-500/30 flex items-center justify-center border-2 border-gray-700/50 group-hover:border-accent/50 transition-colors">
                                    <span className="text-sm font-bold text-white">
                                        {item.user.username[0].toUpperCase()}
                                    </span>
                                </div>
                            )}
                            <span className="text-[10px] text-gray-500 group-hover:text-white truncate w-full text-center transition-colors">
                                {item.user.username}
                            </span>
                        </Link>
                    ))}
                    {remainingCount > 0 && (
                        <button 
                            onClick={() => onTabChange && onTabChange('friends')}
                            className="flex flex-col items-center gap-1.5 w-14 hover:opacity-80 transition-opacity"
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
            <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-5 border border-gray-800/30">
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
                            className="group flex items-center gap-3 hover:bg-dark-100/20 rounded-lg p-1.5 -mx-1.5 transition-colors"
                        >
                            <span className="text-xs text-gray-400 w-6 font-medium">{index + 2}</span>
                            <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-gray-300 font-medium">{genre.name}</span>
                                    <span className="text-[10px] text-gray-500">{genre.count}</span>
                                </div>
                                <div className="h-1 bg-dark-400/30 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gray-600 group-hover:bg-gray-500 rounded-full transition-all duration-300"
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

    if (isPrivate || isLoading || isError || !heatmapData || heatmapData.length === 0) return null;

    return (
        <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg border border-gray-800/30 overflow-hidden">
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
                        <div className="bg-dark-100/30 backdrop-blur-sm rounded-lg p-6 border border-gray-800/30">
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

                    <div className="mt-8">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-white">Recent Activity</h3>
                        </div>
                        <ActivityFeed username={targetUsername} isPrivate={isPrivate} />
                    </div>
                </div>
            </div>
        </div>
    );
}