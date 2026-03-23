import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { activityApi } from '../../api/client';
import { Link } from 'react-router-dom';
import {
    CheckCircle2,
    CircleDashed,
    ListPlus,
    PlayCircle,
    Repeat2,
    Star,
    StickyNote,
    Trash2,
    Workflow,
} from 'lucide-react';
import AnimeMediaImage from '../common/AnimeMediaImage';

const STATUS_FILTERS = [
    { value: 'watching', label: 'Watching', color: '#16a34a' },
    { value: 'completed', label: 'Completed', color: '#3b82f6' },
    { value: 'on_hold', label: 'On Hold', color: '#f59e0b' },
    { value: 'dropped', label: 'Dropped', color: '#ef4444' },
    { value: 'plan_to_watch', label: 'Plan to Watch', color: '#6b7280' },
];

const FILTER_OPTIONS = [
    { value: 'all', label: 'All', icon: CircleDashed },
    ...STATUS_FILTERS,
];

const ACTIVITY_CONFIG = {
    completed: { icon: CheckCircle2, marker: 'bg-emerald-400', chip: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
    added: { icon: ListPlus, marker: 'bg-blue-400', chip: 'text-blue-300 border-blue-500/30 bg-blue-500/10' },
    progress: { icon: PlayCircle, marker: 'bg-accent', chip: 'text-accent-light border-accent/30 bg-accent/10' },
    status_change: { icon: Workflow, marker: 'bg-yellow-400', chip: 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10' },
    score: { icon: Star, marker: 'bg-amber-400', chip: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
    removed: { icon: Trash2, marker: 'bg-rose-400', chip: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
    rewatching: { icon: Repeat2, marker: 'bg-cyan-400', chip: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' },
    notes_update: { icon: StickyNote, marker: 'bg-pink-400', chip: 'text-pink-300 border-pink-500/30 bg-pink-500/10' },
};

function renderActivityDescription(activity) {
    const description = activity?.activity_description || '';
    if (!description) return '';
    const ranges = [];
    const pushRange = (start, end, className, priority = 1, linkTo = null) => {
        if (start < 0 || end <= start) return;
        ranges.push({ start, end, className, priority, linkTo });
    };

    // Highlight anime title with accent and make it clickable.
    const animeTitle = activity?.anime?.title || '';
    const animeSlug = activity?.anime?.slug;
    if (animeTitle) {
        const titleIndex = description.toLowerCase().indexOf(animeTitle.toLowerCase());
        if (titleIndex >= 0) {
            pushRange(
                titleIndex,
                titleIndex + animeTitle.length,
                'font-semibold text-accent',
                3,
                animeSlug ? `/anime/${animeSlug}` : null
            );
        }
    }

    if (ranges.length === 0) return description;

    const boundaries = new Set([0, description.length]);
    ranges.forEach((range) => {
        boundaries.add(range.start);
        boundaries.add(range.end);
    });
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

    const nodes = [];
    for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
        const start = sortedBoundaries[i];
        const end = sortedBoundaries[i + 1];
        const text = description.slice(start, end);
        if (!text) continue;

        const activeRanges = ranges.filter((range) => range.start <= start && range.end >= end);
        const winner = activeRanges.sort((a, b) => b.priority - a.priority)[0];

        if (!winner) {
            nodes.push(<span key={`${start}-${end}`}>{text}</span>);
            continue;
        }

        if (winner.linkTo) {
            nodes.push(
                <Link
                    key={`${start}-${end}`}
                    to={winner.linkTo}
                    className={`${winner.className} cursor-pointer hover:text-accent/80 transition-colors`}
                >
                    {text}
                </Link>
            );
            continue;
        }

        nodes.push(
            <span key={`${start}-${end}`} className={winner.className}>
                {text}
            </span>
        );
    }

    return nodes;
}

function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateGroupLabel(dateValue) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const sameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    if (sameDay(dateValue, today)) return 'Today';
    if (sameDay(dateValue, yesterday)) return 'Yesterday';

    return dateValue.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: dateValue.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
}

function groupActivitiesByDate(activities) {
    const groupsMap = new Map();
    const grouped = [];

    activities.forEach(activity => {
        const activityDate = new Date(activity.created_at);
        const dateKey = `${activityDate.getFullYear()}-${String(activityDate.getMonth() + 1).padStart(2, '0')}-${String(activityDate.getDate()).padStart(2, '0')}`;

        if (!groupsMap.has(dateKey)) {
            const dateGroup = {
                key: dateKey,
                label: formatDateGroupLabel(activityDate),
                activities: [],
            };
            groupsMap.set(dateKey, dateGroup);
            grouped.push(dateGroup);
        }
        groupsMap.get(dateKey).activities.push(activity);
    });

    return grouped;
}

function parseNextPage(lastPage) {
    if (!lastPage?.next) return undefined;

    try {
        const parsed = new URL(lastPage.next, 'http://localhost');
        const page = Number(parsed.searchParams.get('page'));
        return Number.isFinite(page) && page > 0 ? page : undefined;
    } catch {
        return undefined;
    }
}

function activityMetadata(activity) {
    if (activity.activity_type === 'status_change') {
        return null;
    }

    if (activity.activity_type === 'score' && activity.new_score != null) {
        return null;
    }

    if (activity.activity_type === 'completed' && activity.new_score != null) {
        return null;
    }

    return null;
}

function EmptyState({ filterType }) {
    const isFiltered = filterType !== 'all';

    return (
        <div className="ui-empty-state py-14">
            <p className="text-sm text-gray-300">
                {isFiltered ? 'No entries for this filter yet.' : 'No watching activity yet.'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
                {isFiltered ? 'Try another filter to see more updates.' : 'Updates will appear when list progress changes.'}
            </p>
        </div>
    );
}

function ActivityCard({ activity }) {
    const config = ACTIVITY_CONFIG[activity.activity_type] || ACTIVITY_CONFIG.added;
    const anime = activity.anime;
    const metadata = activityMetadata(activity);
    const title = anime?.title || 'Unknown title';

    return (
        <article className="group relative overflow-hidden rounded-lg border border-gray-800/70 bg-gradient-to-br from-dark-100/85 to-dark-200/85 p-1.5 transition-colors hover:border-gray-700">
            <div className="flex items-stretch gap-2">
                <div className="flex min-w-0 flex-1 flex-col px-1 py-0.5">
                    <div className="mb-0">
                        <p className="text-sm leading-tight text-gray-100">
                            {renderActivityDescription(activity)}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {metadata && (
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${config.chip}`}>
                                {metadata}
                            </span>
                        )}
                    </div>

                    {activity.notes && (
                        <p className="mt-1.5 line-clamp-2 rounded-lg border border-gray-800/80 bg-dark-200/60 px-2 py-1.5 text-xs italic text-gray-400">
                            "{activity.notes}"
                        </p>
                    )}
                    <div className="mt-0.5">
                        <span className="text-[10px] text-gray-500">
                            {timeAgo(activity.created_at)}
                        </span>
                    </div>
                </div>

                {anime?.slug && (
                    <Link
                        to={`/anime/${anime.slug}`}
                        className="w-10 shrink-0 overflow-hidden rounded-md border border-gray-800/80 bg-dark-50 transition-colors group-hover:border-gray-700"
                    >
                        <AnimeMediaImage
                            anime={anime}
                            kind="cover"
                            size="small"
                            alt={title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                        />
                    </Link>
                )}
            </div>
        </article>
    );
}

export default function ActivityFeed({ username, isPrivate, compact = false }) {
    const [filterType, setFilterType] = useState('all');
    const pageSize = compact ? 8 : 16;

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetching,
        isLoading,
        isError,
        refetch,
    } = useInfiniteQuery({
        queryKey: ['activity-feed', username, filterType, pageSize],
        queryFn: ({ pageParam }) =>
            activityApi.getFeed({
                username,
                page: pageParam,
                page_size: pageSize,
                ...(filterType !== 'all' ? { type: filterType } : {}),
            }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: parseNextPage,
        enabled: !isPrivate && !!username,
        placeholderData: keepPreviousData,
        staleTime: 2 * 60 * 1000,
    });

    if (isPrivate) {
        return (
            <div className="ui-empty-state py-12">
                <p className="text-sm text-gray-400">Activity is not available for private profiles.</p>
            </div>
        );
    }

    const activities = data?.pages?.flatMap(page => page?.results || []) || [];

    const filteredActivities = filterType === 'all'
        ? activities
        : activities.filter((activity) => {
            const status = (activity.new_status || activity.status || activity.status_label || '').toLowerCase();
            const value = filterType.toLowerCase();
            if (!status) return false;
            if (value === 'watching') return status === 'watching';
            if (value === 'completed') return status === 'completed';
            if (value === 'on_hold') return status === 'on hold' || status === 'on_hold';
            if (value === 'dropped') return status === 'dropped';
            if (value === 'plan_to_watch') return status === 'plan to watch' || status === 'plan_to_watch';
            return false;
        });

    const dateGroups = groupActivitiesByDate(filteredActivities);
    const isFilterUpdating = isFetching && !isFetchingNextPage;
    const [stableDateGroups, setStableDateGroups] = useState([]);

    useEffect(() => {
        if (!isLoading && !isError && !isFilterUpdating) {
            setStableDateGroups(dateGroups);
        }
    }, [dateGroups, isError, isFilterUpdating, isLoading]);

    const visibleDateGroups = isFilterUpdating && stableDateGroups.length > 0
        ? stableDateGroups
        : dateGroups;
    const visibleActivityCount = visibleDateGroups.reduce(
        (total, group) => total + group.activities.length,
        0
    );

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((filter) => {
                    const isActive = filterType === filter.value;
                    return (
                        <button
                            key={filter.value}
                            type="button"
                            onClick={() => setFilterType(filter.value)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
                                ? 'border-accent/60 bg-accent/15 text-accent-light'
                                : 'border-gray-700/80 bg-dark-100/70 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                                }`}
                        >
                            {filter.color ? (
                                <span
                                    className="h-3 w-3 rounded-[6px]"
                                    style={{ backgroundColor: filter.color }}
                                />
                            ) : (
                                <CircleDashed className="h-3.5 w-3.5" />
                            )}
                            {filter.label}
                        </button>
                    );
                })}
                {isFilterUpdating && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/80 bg-dark-100/70 px-3 py-1.5 text-xs font-semibold text-gray-300">
                        <span className="h-3.5 w-3.5 rounded-full border border-gray-400/50 border-t-gray-100 animate-spin" />
                        Updating...
                    </span>
                )}
            </div>

            {isLoading && activities.length === 0 && (
                <div className="space-y-2">
                    {Array.from({ length: compact ? 3 : 5 }).map((_, index) => (
                        <div key={index} className="h-20 animate-pulse rounded-xl border border-gray-800/60 bg-dark-100/60" />
                    ))}
                </div>
            )}

            {isError && (
                <div className="ui-empty-state py-12">
                    <p className="text-sm text-gray-300">Failed to load activity feed.</p>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="mt-3 rounded-lg border border-gray-700 bg-dark-100 px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-accent/50 hover:text-white"
                    >
                        Retry
                    </button>
                </div>
            )}

            {!isLoading && !isError && !isFilterUpdating && visibleActivityCount === 0 && (
                <EmptyState filterType={filterType} />
            )}

            {!isLoading && !isError && visibleActivityCount > 0 && (
                <div className="relative">
                    <div className={`space-y-5 transition-opacity duration-200 ${isFilterUpdating ? 'opacity-60' : 'opacity-100'}`}>
                        {visibleDateGroups.map((group) => (
                            <div key={group.key}>
                                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">
                                    {group.label}
                                </h4>
                                <div className="space-y-2">
                                    {group.activities.map((activity) => (
                                        <ActivityCard key={activity.id} activity={activity} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    {isFilterUpdating && (
                        <div className="pointer-events-none absolute inset-0 rounded-xl bg-dark/20 backdrop-blur-[1px]" aria-hidden="true" />
                    )}
                </div>
            )}

            {hasNextPage && !isError && (
                <div className="flex justify-center pt-1">
                    <button
                        type="button"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="rounded-lg border border-gray-700 bg-dark-100 px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isFetchingNextPage ? 'Loading...' : 'Load More Activity'}
                    </button>
                </div>
            )}
        </section>
    );
}
