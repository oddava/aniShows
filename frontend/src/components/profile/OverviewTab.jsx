import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ActivityFeed from './ActivityFeed';
import ActivityHeatmap from '../ActivityHeatmap';
import AnimeMediaImage from '../common/AnimeMediaImage';
import {
    activityApi,
    characterFavoriteApi,
    favoriteApi,
    listApi,
    staffFavoriteApi,
} from '../../api/client';

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
        <div className="flex items-center justify-center gap-8 sm:gap-12 flex-wrap py-4 border-b border-accent/30 mb-8">
            {stats.map((stat, i) => (
                <div key={i} className="text-center">
                    <span className="text-xl sm:text-2xl font-bold text-white">
                        {stat.value}
                    </span>
                    <span className="block text-[11px] uppercase tracking-wider mt-1 text-gray-500">
                        {stat.label}
                    </span>
                </div>
            ))}
        </div>
    );
}

function CurrentlyWatchingGrid({ watchingItems }) {
    if (!watchingItems || watchingItems.length === 0) {
        return (
            <div className="mb-10">
                <div className="ui-surface-subtle p-5">
                    <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">Currently Watching</h3>
                    <div className="text-center py-6 text-gray-500">
                        <p className="text-sm">Not watching anything right now</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <div className="ui-surface-subtle p-5">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">Currently Watching</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 gap-4">
                    {watchingItems.map((item) => {
                        const eps = item.episodes_watched || 0;
                        const total = item.anime?.episode_count || 0;
                        const progress = total > 0 ? (eps / total) * 100 : 0;

                        return (
                            <div key={item.id} className="group relative">
                                <Link
                                    to={`/anime/${item.anime?.slug}`}
                                    className="block relative aspect-[2/3] bg-dark-200 rounded-lg overflow-hidden"
                                >
                                    <AnimeMediaImage
                                        anime={item.anime}
                                        kind="cover"
                                        size="small"
                                        alt={item.anime?.title}
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-dark-400/80 z-20">
                                        <div
                                            className="h-full bg-accent transition-[width] duration-300"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </Link>

                                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark-100 border border-gray-700 px-3 py-2 text-center opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:-translate-y-1">
                                    <p className="text-[11px] font-bold text-white max-w-[180px] truncate">{item.anime?.title}</p>
                                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                                        {item.anime?.anime_type} • {eps} / {total || '?'} eps
                                    </p>
                                    {/* Arrow */}
                                    <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 border-b border-r border-gray-700 bg-dark-100"></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function getFavoritesItems(favoritesData) {
    return favoritesData?.pages?.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || favoritesData?.results || favoritesData || [];
}

function AnimeFavoritesGrid({ favoritesData }) {
    const favorites = getFavoritesItems(favoritesData);

    if (!favorites || favorites.length === 0) {
        return (
            <div className="mb-10">
                <div className="ui-surface-subtle p-5">
                    <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">Favorites</h3>
                    <div className="text-center py-6 text-gray-500">
                        <p className="text-sm">No favorites yet</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <div className="ui-surface-subtle p-5">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">Favorites</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 gap-4">
                    {favorites.map((fav) => (
                        <div key={fav.id} className="group relative">
                            <Link
                                to={`/anime/${fav.anime?.slug}`}
                                className="block relative aspect-[2/3] bg-dark-200 rounded-lg overflow-hidden"
                            >
                                <AnimeMediaImage
                                    anime={fav.anime}
                                    kind="cover"
                                    size="small"
                                    alt={fav.anime?.title}
                                    className="w-full h-full object-cover"
                                />
                            </Link>

                            {/* Floating Tooltip */}
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark-100 border border-gray-700 px-3 py-2 text-center opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:-translate-y-1">
                                <p className="text-[11px] font-bold text-white max-w-[180px] truncate">{fav.anime?.title}</p>
                                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-400">
                                    {fav.anime?.anime_type}
                                </p>
                                {/* Arrow */}
                                <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 border-b border-r border-gray-700 bg-dark-100"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function PersonFavoritesGrid({ title, items, emptyText, itemKey, hrefBuilder, nameKey }) {
    if (!items || items.length === 0) {
        return (
            <div className="mb-10">
                <div className="ui-surface-subtle p-5">
                    <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">{title}</h3>
                    <div className="py-6 text-center text-gray-500">
                        <p className="text-sm">{emptyText}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <div className="ui-surface-subtle p-5">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">{title}</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 gap-4">
                    {items.map((entry) => {
                        const item = entry[itemKey];
                        return (
                            <div key={entry.id} className="group relative">
                                <Link
                                    to={hrefBuilder(item)}
                                    className="block relative aspect-[2/3] bg-dark-200 rounded-lg overflow-hidden"
                                >
                                    <img
                                        src={item?.image || '/placeholder-avatar.png'}
                                        alt={item?.[nameKey]}
                                        loading="lazy"
                                        className="w-full h-full object-cover"
                                    />
                                </Link>

                                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark-100 border border-gray-700 px-3 py-2 text-center opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:-translate-y-1">
                                    <p className="max-w-[180px] truncate text-[11px] font-bold text-white">{item?.[nameKey]}</p>
                                    {item?.name_native && (
                                        <p className="mt-0.5 max-w-[180px] truncate text-[9px] font-bold uppercase tracking-[0.1em] text-gray-400">
                                            {item.name_native}
                                        </p>
                                    )}
                                    <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 border-b border-r border-gray-700 bg-dark-100"></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
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
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-4">Top Genres</h3>

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

function ActivityHistorySidebar({ username, isPrivate, accentColor }) {
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
            <ActivityHeatmap activityData={heatmapData} accentColor={accentColor} />
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

    const { data: characterFavsData } = useQuery({
        queryKey: ['character-favorites', targetUsername, 'overview'],
        queryFn: () => characterFavoriteApi.getAll({ username: targetUsername, page: 1, page_size: 10 }).then((res) => res.data),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000,
        refetchOnMount: true,
    });

    const { data: staffFavsData } = useQuery({
        queryKey: ['staff-favorites', targetUsername, 'overview'],
        queryFn: () => staffFavoriteApi.getAll({ username: targetUsername, page: 1, page_size: 10 }).then((res) => res.data),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000,
        refetchOnMount: true,
    });

    const watchingItems = watchingItemsData || [];
    const favoritesData = favsData || [];
    const characterFavorites = getFavoritesItems(characterFavsData);
    const staffFavorites = getFavoritesItems(staffFavsData);

    return (
        <div className="animate-tab-content pb-8 overview-tab">
            <TopStatsRow user={displayUser} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                <div className="lg:col-span-6 space-y-8">
                    {displayUser?.bio ? (
                        <div className="ui-surface-subtle p-6">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-4">About</h3>
                            <div className="text-sm text-gray-300 leading-relaxed max-h-[400px] overflow-y-auto custom-scrollbar pr-3">
                                <MarkdownRenderer content={displayUser.bio} />
                            </div>
                        </div>
                    ) : null}

                    {displayUser?.social_links && displayUser.social_links.length > 0 ? (
                        <div className="ui-surface-subtle p-5">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-4">Links</h3>
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



                    <ActivityHistorySidebar
                        username={targetUsername}
                        isPrivate={isPrivate}
                        accentColor={displayUser?.profile_primary_color}
                    />

                    <GenreOverviewSidebar username={targetUsername} isPrivate={isPrivate} />

                    <div className="ui-surface-subtle p-5">
                        <div className="mb-5 flex items-center justify-between gap-4">
                            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-gray-500">Activity</h3>
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

                <div className="lg:col-span-6 min-h-[400px]">
                    <AnimeFavoritesGrid favoritesData={favoritesData} />

                    <PersonFavoritesGrid
                        title="Characters"
                        items={characterFavorites}
                        emptyText="No characters yet"
                        itemKey="character"
                        hrefBuilder={(character) => `/character/${character?.id}`}
                        nameKey="name"
                    />

                    <PersonFavoritesGrid
                        title="Voice Actors"
                        items={staffFavorites}
                        emptyText="No voice actors yet"
                        itemKey="staff"
                        hrefBuilder={(staff) => `/staff/${staff?.id}`}
                        nameKey="name"
                    />

                    <CurrentlyWatchingGrid watchingItems={watchingItems} />
                </div>
            </div>
        </div>
    );
}
