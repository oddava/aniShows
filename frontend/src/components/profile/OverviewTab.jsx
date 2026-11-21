import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ActivityFeed from './ActivityFeed';
import ActivityHeatmap from '../ActivityHeatmap';
import Portrait from '../ui/Portrait';
import AnimeMediaImage from '../common/AnimeMediaImage';
import { activityQueries, characterFavoriteQueries, favoriteQueries, insightsQueries, listQueries, staffFavoriteQueries } from '../../api/queries/user';

const OVERVIEW_GRID_MAX_ROWS = 6;
const OVERVIEW_GRID_COLUMNS = 6;
const OVERVIEW_GRID_MAX_ITEMS = OVERVIEW_GRID_MAX_ROWS * OVERVIEW_GRID_COLUMNS;

/*
 * The profile's headline numbers. They come from the same server calculation
 * as the Stats tab (P1), and each says what it counts.
 */
function TopStatsRow({ user, isOwnProfile }) {
    if (!user) return null;

    if (!user.anime_count && isOwnProfile) {
        return <GettingStarted user={user} />;
    }

    const rated = Number(user.rated_count) || 0;
    const stats = [
        { label: 'Anime', value: user.anime_count || 0, note: 'on the list' },
        { label: 'Episodes', value: (user.episodes_watched || 0).toLocaleString(), note: 'watched' },
        {
            label: 'Mean score',
            value: user.mean_score ?? '—',
            note: rated ? `of ${rated} rated` : 'nothing rated yet',
        },
        { label: 'Days', value: user.days_watched ?? 0, note: 'of watching' },
        { label: 'Favourites', value: user.favorites_count || 0 },
        {
            label: 'Resonance',
            value: user.resonance_count || 0,
            note: 'helpful votes',
            title: 'Resonance: how many times people marked this user’s reviews helpful',
        },
    ];

    return (
        <div className="mb-8 border-b border-white/[0.06] pb-6">
            <dl className="mx-auto grid max-w-4xl grid-cols-3 gap-x-4 gap-y-5 text-center sm:grid-cols-6">
                {stats.map((stat) => (
                    <div key={stat.label} title={stat.title}>
                        <dt className="sr-only">{stat.label}</dt>
                        <dd className="font-display text-[1.75rem] font-extrabold leading-none text-white tabular">
                            {stat.value}
                        </dd>
                        <dd className="mt-1.5 text-xs font-semibold text-gray-300">{stat.label}</dd>
                        {stat.note && <dd className="text-[11px] text-gray-500">{stat.note}</dd>}
                    </div>
                ))}
            </dl>
        </div>
    );
}

/** A new profile gets three next steps instead of a wall of zeros (P3). */
function GettingStarted({ user }) {
    const steps = [
        { done: false, title: 'Bring your list', body: 'Import from MyAnimeList or AniList in one go. Nothing is ever written back.', to: '/import', cta: 'Import' },
        { done: (user.anime_count || 0) >= 5, title: 'Add five shows', body: 'Tap + on any poster: Watching, Completed, Planning.', to: '/browse', cta: 'Browse' },
        { done: (user.favorites_count || 0) > 0, title: 'Pick favourites', body: 'The heart on a show’s page puts it on your profile.', to: '/browse?sort=rating', cta: 'Top rated' },
    ];
    return (
        <div className="mb-8">
            <h2 className="section-title mb-4">Get started</h2>
            <ol className="grid gap-3 sm:grid-cols-3">
                {steps.map((step, index) => (
                    <li key={step.title} className="flex flex-col rounded-[var(--radius-lg)] bg-white/[0.03] p-4">
                        <span className="text-xs font-semibold text-gray-500 tabular">Step {index + 1}</span>
                        <span className="mt-1 font-semibold text-white">{step.title}</span>
                        <span className="mt-1 flex-1 text-sm text-gray-400">{step.body}</span>
                        <Link to={step.to} className="btn-secondary mt-4 self-start px-4 text-sm">{step.cta}</Link>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function CurrentlyWatchingGrid({ watchingItems }) {
    const visibleWatchingItems = (watchingItems || []).slice(0, OVERVIEW_GRID_MAX_ITEMS);

    if (visibleWatchingItems.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="mb-4 ml-4 text-sm font-semibold text-gray-300">Currently Watching</h3>
                <div className="ui-surface-subtle p-5">
                    <div className="text-center py-6 text-gray-500">
                        <p className="text-sm">Not watching anything right now</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="mb-4 ml-4 text-sm font-semibold text-gray-300">Currently Watching</h3>
            <div className="ui-surface-subtle p-5">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 gap-4">
                    {visibleWatchingItems.map((item) => {
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
                                            className="h-full bg-accent-dark transition-[width] duration-300"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </Link>

                                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark-100 border border-gray-700 px-3 py-2 text-center opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:-translate-y-1">
                                    <p className="text-[11px] font-bold text-white max-w-[180px] truncate">{item.anime?.title}</p>
                                    <p className="mt-0.5 text-xs font-bold text-accent">
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
    const favorites = getFavoritesItems(favoritesData).slice(0, OVERVIEW_GRID_MAX_ITEMS);

    if (!favorites || favorites.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="mb-4 text-sm font-semibold text-gray-300">Favorites</h3>
                <div className="ui-surface-subtle p-5">
                    <div className="text-center py-6 text-gray-500">
                        <p className="text-sm">No favorites yet</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="mb-4 ml-4 text-sm font-semibold text-gray-300">Favorites</h3>
            <div className="ui-surface-subtle p-5">
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
                                <p className="mt-0.5 text-xs font-bold text-gray-400">
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
    const visibleItems = (items || []).slice(0, OVERVIEW_GRID_MAX_ITEMS);

    if (visibleItems.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="mb-4 text-sm font-semibold text-gray-300">{title}</h3>
                <div className="ui-surface-subtle p-5">
                    <div className="py-6 text-center text-gray-500">
                        <p className="text-sm">{emptyText}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-10">
            <h3 className="mb-4 ml-4 text-sm font-semibold text-gray-300">{title}</h3>
            <div className="ui-surface-subtle p-5">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 gap-4">
                    {visibleItems.map((entry) => {
                        const item = entry[itemKey];
                        return (
                            <div key={entry.id} className="group relative">
                                <Link
                                    to={hrefBuilder(item)}
                                    className="block relative aspect-[2/3] bg-dark-200 rounded-lg overflow-hidden"
                                >
                                    <Portrait src={item?.image} alt={item?.[nameKey]} sizes="120px" className="h-full w-full" />
                                </Link>

                                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark-100 border border-gray-700 px-3 py-2 text-center opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:-translate-y-1">
                                    <p className="max-w-[180px] truncate text-[11px] font-bold text-white">{item?.[nameKey]}</p>
                                    {item?.name_native && (
                                        <p className="mt-0.5 max-w-[180px] truncate text-xs font-bold text-gray-400">
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
        ...insightsQueries.overviewLists(username),
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
            <h3 className="mb-4 ml-4 text-[11px] font-semibold text-gray-500">Top Genres</h3>
            <div className="ui-surface-subtle p-5">
                <div className="mb-4 pb-4 border-b border-gray-800/30">
                    <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-300">{sortedGenres[0].name}</span>
                        <span className="text-xs font-medium text-gray-400">{sortedGenres[0].count}</span>
                    </div>
                    <div className="h-2 bg-dark-400/50 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent-dark rounded-full transition-all duration-500"
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
                            <span className="text-[11px] text-gray-500 w-6 font-medium">{index + 2}</span>
                            <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] text-gray-400 font-medium">{genre.name}</span>
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
        ...activityQueries.heatmap(username),
        enabled: !isPrivate && !!username,
        staleTime: 2 * 60 * 1000, // 2 minutes
        refetchOnMount: true,
    });

    if (isPrivate || isLoading || isError || !heatmapData) return null;

    return (
        <div className="mb-8">
            <ActivityHeatmap activityData={heatmapData} accentColor={accentColor} />
        </div>
    );
}

export default function OverviewTab({
    displayUser,
    targetUsername,
    isPrivate,
    onTabChange,
    isOwnProfile = false,
}) {
    const { data: watchingItemsData } = useQuery({
        ...listQueries.overview(targetUsername, 'Watching', OVERVIEW_GRID_MAX_ITEMS),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000, // 1 minute
        refetchOnMount: true,
    });

    const { data: favsData } = useQuery({
        ...favoriteQueries.overview(targetUsername, OVERVIEW_GRID_MAX_ITEMS),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000, // 1 minute
        refetchOnMount: true,
    });

    const { data: characterFavsData } = useQuery({
        ...characterFavoriteQueries.overview(targetUsername, OVERVIEW_GRID_MAX_ITEMS),
        enabled: !!displayUser && !isPrivate,
        staleTime: 60 * 1000,
        refetchOnMount: true,
    });

    const { data: staffFavsData } = useQuery({
        ...staffFavoriteQueries.overview(targetUsername, OVERVIEW_GRID_MAX_ITEMS),
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
            <TopStatsRow user={displayUser} isOwnProfile={isOwnProfile} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                <div className="lg:col-span-6 space-y-8">
                    {displayUser?.bio ? (
                        <div className="mb-8">
                            <h3 className="mb-4 ml-4 text-sm font-semibold text-gray-300">About</h3>
                            <div className="ui-surface-subtle p-5">
                                <div className="overview-about-scroll overflow-y-auto custom-scrollbar pr-1">
                                    <MarkdownRenderer content={displayUser.bio} className="overview-about-markdown" />
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {displayUser?.social_links && displayUser.social_links.length > 0 ? (
                        <div className="mb-8">
                            <h3 className="mb-4 ml-4 text-sm font-semibold text-gray-300">Links</h3>
                            <div className="ui-surface-subtle p-5">
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
                        </div>
                    ) : null}



                    <ActivityHistorySidebar
                        username={targetUsername}
                        isPrivate={isPrivate}
                        accentColor={displayUser?.profile_primary_color}
                    />

                    <GenreOverviewSidebar username={targetUsername} isPrivate={isPrivate} />

                    <div className="mb-8">
                        <div className="mb-4 ml-4 flex items-center justify-between gap-4">
                            <h3 className="text-[11px] font-semibold text-gray-500">Activity</h3>
                            <button
                                type="button"
                                onClick={() => onTabChange && onTabChange('activity')}
                                className="rounded-lg bg-dark-100/80 px-3 py-1.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-dark-50 hover:text-gray-200"
                            >
                                View Full Feed
                            </button>
                        </div>
                        <div className="ui-surface-subtle p-5">
                            <ActivityFeed username={targetUsername} isPrivate={isPrivate} compact />
                        </div>
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
