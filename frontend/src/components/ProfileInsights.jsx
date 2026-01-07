import { useQuery } from '@tanstack/react-query';
import { listApi, reviewApi } from '../api/client';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Star, Tv, Clock, BarChart3 } from 'lucide-react';

// Color palette for charts
const GENRE_COLORS = [
    '#8b5cf6', '#ec4899', '#06b6d4', '#22c55e', '#f59e0b',
    '#ef4444', '#3b82f6', '#a855f7', '#14b8a6', '#f97316'
];

const SCORE_COLORS = {
    10: '#22c55e', 9: '#4ade80', 8: '#86efac',
    7: '#3b82f6', 6: '#60a5fa', 5: '#93c5fd',
    4: '#f59e0b', 3: '#fbbf24', 2: '#ef4444', 1: '#dc2626'
};

// eslint-disable-next-line no-unused-vars
const StatCard = ({ icon: Icon, label, value, subtext }) => (
    <div className="bg-dark-100/50 rounded-xl border border-gray-800 p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Icon className="w-6 h-6 text-accent" />
        </div>
        <div>
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-gray-400">{label}</div>
            {subtext && <div className="text-[10px] text-gray-500 mt-0.5">{subtext}</div>}
        </div>
    </div>
);

// Custom tooltip for charts - defined outside component to avoid re-creation
const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-dark-50 border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
                <p className="text-white text-sm font-medium">{payload[0].payload.name || `Score ${payload[0].payload.score}`}</p>
                <p className="text-gray-400 text-xs">{payload[0].value} anime</p>
            </div>
        );
    }
    return null;
};

export default function ProfileInsights({ username, isPrivate }) {
    // Fetch all anime lists to calculate insights
    const { data: listsData, isLoading: listsLoading } = useQuery({
        queryKey: ['insights-lists', username],
        queryFn: async () => {
            const statuses = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
            const results = await Promise.all(
                statuses.map(status =>
                    listApi.getAll({ status, username }).then(res => ({
                        status,
                        items: res.data.results || res.data || []
                    }))
                )
            );
            return results;
        },
        enabled: !isPrivate,
    });

    // Fetch reviews for score distribution
    const { data: reviewsData, isLoading: reviewsLoading } = useQuery({
        queryKey: ['insights-reviews', username],
        queryFn: () => reviewApi.getAll({ user: username }).then(res => res.data.results || res.data || []),
        enabled: !isPrivate,
    });

    if (isPrivate) {
        return (
            <div className="text-center py-16 text-gray-400">
                <p>Insights are not available for private profiles.</p>
            </div>
        );
    }

    if (listsLoading || reviewsLoading) {
        return (
            <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Calculate total anime and episodes
    const allItems = listsData?.flatMap(g => g.items) || [];
    const totalAnime = allItems.length;
    const totalEpisodes = allItems.reduce((sum, item) => sum + (item.episodes_watched || 0), 0);
    const completedCount = listsData?.find(g => g.status === 'Completed')?.items.length || 0;
    const watchingCount = listsData?.find(g => g.status === 'Watching')?.items.length || 0;

    // Calculate genre distribution
    const genreCounts = {};
    allItems.forEach(item => {
        item.anime?.genres?.forEach(genre => {
            genreCounts[genre.name] = (genreCounts[genre.name] || 0) + 1;
        });
    });

    const genreData = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, value], index) => ({
            name,
            value,
            color: GENRE_COLORS[index % GENRE_COLORS.length]
        }));

    // Calculate score distribution from reviews
    const reviews = Array.isArray(reviewsData) ? reviewsData : [];
    const scoreCounts = {};
    for (let i = 1; i <= 10; i++) scoreCounts[i] = 0;

    reviews.forEach(review => {
        const score = review.rating;
        if (score >= 1 && score <= 10) {
            scoreCounts[score]++;
        }
    });

    const scoreData = Object.entries(scoreCounts)
        .map(([score, count]) => ({
            score: parseInt(score),
            count,
            fill: SCORE_COLORS[score] || '#6b7280'
        }))
        .sort((a, b) => a.score - b.score);

    const avgScore = reviews.length > 0
        ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
        : '-';

    return (
        <div className="space-y-8">
            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Tv} label="Total Anime" value={totalAnime} />
                <StatCard icon={Clock} label="Episodes" value={totalEpisodes.toLocaleString()} />
                <StatCard icon={TrendingUp} label="Completed" value={completedCount} />
                <StatCard icon={Star} label="Avg Score" value={avgScore} subtext={`from ${reviews.length} reviews`} />
            </div>

            {/* Charts Grid */}
            <div className="grid md:grid-cols-2 gap-6">
                {/* Genre Distribution */}
                <div className="bg-dark-100 rounded-xl border border-gray-800 p-6">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-accent" />
                        Genre Distribution
                    </h3>
                    {genreData.length > 0 ? (
                        <div className="flex flex-col md:flex-row items-center gap-6">
                            <div className="w-48 h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={genreData}
                                            dataKey="value"
                                            nameKey="name"
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            innerRadius={40}
                                        >
                                            {genreData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5">
                                {genreData.map((genre) => (
                                    <div key={genre.name} className="flex items-center gap-2 text-sm">
                                        <div
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: genre.color }}
                                        />
                                        <span className="text-gray-300 truncate text-xs">{genre.name}</span>
                                        <span className="text-gray-500 ml-auto text-xs">{genre.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <p>No genre data available yet.</p>
                        </div>
                    )}
                </div>

                {/* Score Distribution */}
                <div className="bg-dark-100 rounded-xl border border-gray-800 p-6">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Star className="w-5 h-5 text-yellow-500" />
                        Score Distribution
                    </h3>
                    {reviews.length > 0 ? (
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={scoreData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <XAxis
                                        dataKey="score"
                                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                                        axisLine={{ stroke: '#374151' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fill: '#9ca3af', fontSize: 11 }}
                                        axisLine={{ stroke: '#374151' }}
                                        tickLine={false}
                                        allowDecimals={false}
                                        width={30}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar
                                        dataKey="count"
                                        radius={[4, 4, 0, 0]}
                                    >
                                        {scoreData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <p>No reviews yet to show score distribution.</p>
                            <p className="text-xs mt-1">Start reviewing anime to see your rating patterns!</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Watching Progress */}
            {watchingCount > 0 && (
                <div className="bg-dark-100 rounded-xl border border-gray-800 p-6">
                    <h3 className="text-lg font-bold text-white mb-4">Currently Watching Progress</h3>
                    <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                        {listsData?.find(g => g.status === 'Watching')?.items.slice(0, 10).map((item) => {
                            const eps = item.episodes_watched || 0;
                            const total = item.anime?.episode_count || 0;
                            const progress = total > 0 ? (eps / total) * 100 : 0;

                            return (
                                <div key={item.id} className="flex items-center gap-3">
                                    <img
                                        src={item.anime?.cover_image}
                                        alt={item.anime?.title}
                                        className="w-8 h-12 rounded object-cover shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white truncate">{item.anime?.title}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-accent rounded-full transition-all"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-400 shrink-0">
                                                {eps}/{total || '?'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
