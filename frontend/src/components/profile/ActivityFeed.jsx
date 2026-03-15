import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
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

const FILTER_OPTIONS = [
    { value: 'all', label: 'All', icon: CircleDashed },
    { value: 'progress', label: 'Progress', icon: PlayCircle },
    { value: 'completed', label: 'Completed', icon: CheckCircle2 },
    { value: 'status_change', label: 'Status', icon: Workflow },
    { value: 'added', label: 'Added', icon: ListPlus },
    { value: 'removed', label: 'Removed', icon: Trash2 },
    { value: 'score', label: 'Score', icon: Star },
    { value: 'rewatching', label: 'Rewatch', icon: Repeat2 },
    { value: 'notes_update', label: 'Notes', icon: StickyNote },
];

const ACTIVITY_CONFIG = {
    completed: {
        icon: CheckCircle2,
        marker: 'bg-emerald-400',
        chip: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    },
    added: {
        icon: ListPlus,
        marker: 'bg-blue-400',
        chip: 'text-blue-300 border-blue-500/30 bg-blue-500/10',
    },
    progress: {
        icon: PlayCircle,
        marker: 'bg-accent',
        chip: 'text-accent-light border-accent/30 bg-accent/10',
    },
    status_change: {
        icon: Workflow,
        marker: 'bg-yellow-400',
        chip: 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10',
    },
    score: {
        icon: Star,
        marker: 'bg-amber-400',
        chip: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
    },
    removed: {
        icon: Trash2,
        marker: 'bg-rose-400',
        chip: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
    },
    rewatching: {
        icon: Repeat2,
        marker: 'bg-cyan-400',
        chip: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
    },
    notes_update: {
        icon: StickyNote,
        marker: 'bg-pink-400',
        chip: 'text-pink-300 border-pink-500/30 bg-pink-500/10',
    },
};

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
    if (activity.activity_type === 'status_change' && activity.new_status) {
        return activity.old_status
            ? `${activity.old_status} -> ${activity.new_status}`
            : activity.new_status;
    }

    if (activity.activity_type === 'score' && activity.new_score != null) {
        return `${activity.new_score}/10`;
    }

    if (activity.activity_type === 'completed' && activity.new_score != null) {
        return `${activity.new_score}/10`;
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
    const coverImage = anime?.cover_image_small || anime?.cover_image;
    const metadata = activityMetadata(activity);
    const title = anime?.title || 'Unknown title';

    return (
        <article className="group relative overflow-hidden rounded-xl border border-gray-800/70 bg-gradient-to-br from-dark-100/85 to-dark-200/85 p-3 transition-colors hover:border-gray-700">
            <div className="absolute left-0 top-0 h-full w-1 bg-gray-700/80">
                <span className={`block h-full w-full ${config.marker}`} />
            </div>

            <div className="flex gap-3 pl-2">
                <div className="flex-1 min-w-0">
                    <div className="mb-1">
                        <p className="text-sm leading-5 text-gray-100">
                            {activity.activity_description}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-gray-500">
                            {timeAgo(activity.created_at)}
                        </span>
                        {metadata && (
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${config.chip}`}>
                                {metadata}
                            </span>
                        )}
                    </div>

                    {activity.notes && (
                        <p className="mt-2 line-clamp-2 rounded-lg border border-gray-800/80 bg-dark-200/60 px-2.5 py-2 text-xs italic text-gray-400">
                            "{activity.notes}"
                        </p>
                    )}
                </div>

                {anime?.slug && coverImage && (
                    <Link
                        to={`/anime/${anime.slug}`}
                        className="shrink-0 overflow-hidden rounded-lg border border-gray-800/80 transition-colors group-hover:border-gray-700"
                    >
                        <img
                            src={coverImage}
                            alt={title}
                            className="h-16 w-11 object-cover"
                            loading="lazy"
                        />
                    </Link>
                )}
            </div>

            {anime?.slug && (
                <Link
                    to={`/anime/${anime.slug}`}
                    className="mt-1 ml-2 block truncate text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
                >
                    {title}
                </Link>
            )}
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
    const dateGroups = groupActivitiesByDate(activities);

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((filter) => {
                    const Icon = filter.icon;
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
                            <Icon className="h-3.5 w-3.5" />
                            {filter.label}
                        </button>
                    );
                })}
            </div>

            {isLoading && (
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

            {!isLoading && !isError && activities.length === 0 && (
                <EmptyState filterType={filterType} />
            )}

            {!isLoading && !isError && activities.length > 0 && (
                <div className="space-y-5">
                    {dateGroups.map((group) => (
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
