import { useInfiniteQuery } from '@tanstack/react-query';
import { activityApi } from '../../api/client';
import { Link } from 'react-router-dom';
import { Check, Play, Pause, Trash2, Bookmark, Star, RotateCcw, TrendingUp, Clock, StickyNote } from 'lucide-react';

const ACTIVITY_CONFIG = {
    completed: { icon: Check, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
    added: { icon: Bookmark, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    progress: { icon: Play, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    status_change: { icon: TrendingUp, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
    score: { icon: Star, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    removed: { icon: Trash2, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    rewatching: { icon: RotateCcw, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    notes_update: { icon: StickyNote, color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
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

function ActivityCard({ activity }) {
    const config = ACTIVITY_CONFIG[activity.activity_type] || ACTIVITY_CONFIG.added;
    const Icon = config.icon;
    const anime = activity.anime;

    return (
        <div className={`${config.bg} border ${config.border} rounded-xl p-4 transition-all hover:border-opacity-40`}>
            <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className={`w-4.5 h-4.5 ${config.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 leading-relaxed">
                        {activity.activity_description}
                    </p>

                    {activity.notes && (
                        <p className="text-xs text-gray-400 mt-1.5 italic border-l-2 border-gray-700 pl-2">
                            "{activity.notes}"
                        </p>
                    )}

                    <div className="flex items-center gap-3 mt-2">
                        {anime && (
                            <Link
                                to={`/anime/${anime.slug}`}
                                className="flex items-center gap-2 group"
                            >
                                {anime.cover_image_small && (
                                    <img
                                        src={anime.cover_image_small}
                                        alt={anime.title}
                                        className="w-6 h-8 rounded object-cover"
                                    />
                                )}
                                <span className="text-xs text-gray-500 group-hover:text-accent transition-colors truncate max-w-[200px]">
                                    {anime.title}
                                </span>
                            </Link>
                        )}

                        <div className="flex items-center gap-1 ml-auto shrink-0">
                            <Clock className="w-3 h-3 text-gray-600" />
                            <span className="text-[11px] text-gray-600">{timeAgo(activity.created_at)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ActivityFeed({ username, isPrivate }) {
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError,
        refetch,
    } = useInfiniteQuery({
        queryKey: ['activity-feed', username],
        queryFn: ({ pageParam = 1 }) =>
            activityApi.getFeed({ username, page: pageParam }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !isPrivate && !!username,
        staleTime: 2 * 60 * 1000,
    });

    if (isPrivate) {
        return (
            <div className="text-center py-16 text-gray-400">
                <p>Activity is not available for private profiles.</p>
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
                <p className="text-sm mb-3">Failed to load activity feed.</p>
                <button
                    onClick={() => refetch()}
                    className="px-4 py-2 rounded-xl bg-dark-100 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-all"
                >
                    Try Again
                </button>
            </div>
        );
    }

    const activities = data?.pages.flatMap(page => page.results || page) || [];

    if (activities.length === 0) {
        return (
            <div className="text-center py-16 text-gray-500">
                <Play className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No activity yet.</p>
                <p className="text-xs mt-1 text-gray-600">Start tracking anime to see activity here!</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {activities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} />
            ))}

            {hasNextPage && (
                <div className="flex justify-center pt-4">
                    <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="px-6 py-2.5 rounded-xl bg-dark-100 border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-accent transition-all disabled:opacity-50"
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
