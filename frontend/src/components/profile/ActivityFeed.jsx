import { useInfiniteQuery } from '@tanstack/react-query';
import { activityApi } from '../../api/client';
import { Link } from 'react-router-dom';

const ACTIVITY_CONFIG = {
    completed: { borderColor: 'border-green-500', bgHover: 'hover:bg-green-500/5' },
    added: { borderColor: 'border-blue-500', bgHover: 'hover:bg-blue-500/5' },
    progress: { borderColor: 'border-accent', bgHover: 'hover:bg-accent/5' },
    status_change: { borderColor: 'border-yellow-500', bgHover: 'hover:bg-yellow-500/5' },
    score: { borderColor: 'border-amber-500', bgHover: 'hover:bg-amber-500/5' },
    removed: { borderColor: 'border-red-500', bgHover: 'hover:bg-red-500/5' },
    rewatching: { borderColor: 'border-cyan-500', bgHover: 'hover:bg-cyan-500/5' },
    notes_update: { borderColor: 'border-pink-500', bgHover: 'hover:bg-pink-500/5' },
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

function groupActivitiesByDate(activities) {
    const groups = {};
    
    activities.forEach(activity => {
        const date = new Date(activity.created_at);
        const dateKey = date.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric',
            year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        });
        
        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        groups[dateKey].push(activity);
    });
    
    return groups;
}

function ActivityCard({ activity }) {
    const config = ACTIVITY_CONFIG[activity.activity_type] || ACTIVITY_CONFIG.added;
    const anime = activity.anime;

    return (
        <div className={`flex gap-4 py-3 border-l-2 ${config.borderColor} pl-4 ${config.bgHover} transition-colors`}>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                    {activity.activity_description}
                </p>
                
                {activity.notes && (
                    <p className="text-xs text-gray-500 mt-1 italic line-clamp-1">
                        "{activity.notes}"
                    </p>
                )}
                
                <span className="text-[11px] text-gray-600 mt-1 block">
                    {timeAgo(activity.created_at)}
                </span>
            </div>

            {anime && (
                <Link to={`/anime/${anime.slug}`} className="shrink-0 group">
                    {anime.cover_image_small && (
                        <img
                            src={anime.cover_image_small}
                            alt={anime.title}
                            className="w-10 h-14 rounded object-cover border border-gray-800 group-hover:border-accent/50 transition-colors"
                        />
                    )}
                </Link>
            )}
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
            <div className="text-center py-16 text-gray-400 text-sm">
                Activity is not available for private profiles.
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
                    className="px-4 py-2 rounded-lg bg-dark-100 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-all"
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
                <p className="text-sm">Nothing here yet</p>
                <p className="text-xs mt-1 text-gray-600">Start tracking anime to see activity here</p>
            </div>
        );
    }

    const groupedActivities = groupActivitiesByDate(activities);
    const dateGroups = Object.entries(groupedActivities);

    return (
        <div className="space-y-6">
            {dateGroups.map(([date, dateActivities]) => (
                <div key={date}>
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                        {date}
                    </h4>
                    <div className="space-y-1">
                        {dateActivities.map((activity) => (
                            <ActivityCard key={activity.id} activity={activity} />
                        ))}
                    </div>
                </div>
            ))}

            {hasNextPage && (
                <div className="flex justify-center pt-4">
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