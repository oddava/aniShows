import { useQuery } from '@tanstack/react-query';
import { listApi, reviewApi, activityApi } from '../api/client';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { TrendingUp, Star, Tv, Clock, BarChart3, Activity } from 'lucide-react';
import ActivityHeatmap from './ActivityHeatmap';

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

// Premium Stat Card with Glassmorphism and Glow
const StatCard = ({ icon: Icon, label, value, subtext, color = 'accent' }) => {
    const colorClasses = {
        accent: 'bg-accent/10 text-accent ring-accent/20',
        yellow: 'bg-yellow-500/10 text-yellow-500 ring-yellow-500/20',
        blue: 'bg-blue-500/10 text-blue-500 ring-blue-500/20',
        green: 'bg-green-500/10 text-green-500 ring-green-500/20',
    };

    const gradientColors = {
        accent: 'from-accent/10 to-transparent',
        yellow: 'from-yellow-500/10 to-transparent',
        blue: 'from-blue-500/10 to-transparent',
        green: 'from-green-500/10 to-transparent',
    };

    return (
        <div className="relative group overflow-hidden bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 p-5">
            {/* Subtle Gradient Background */}
            <div className={`absolute -right-8 -top-8 w-24 h-24 blur-3xl opacity-10 group-hover:opacity-20 transition-opacity bg-gradient-to-br ${gradientColors[color]}`} />

            <div className="flex items-center gap-4 relative z-10">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ring-1 ${colorClasses[color] || colorClasses.accent}`}>
                    <Icon className="w-6 h-6" />
                </div>
                <div>
                    <div className="flex items-baseline gap-1">
                        <div className="text-2xl font-black text-white tracking-tight">{value}</div>
                        {subtext && !subtext.includes('from') && <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">{subtext}</span>}
                    </div>
                    <div className="text-[10px] text-gray-400 font-black uppercase tracking-[0.1em]">{label}</div>
                    {subtext && subtext.includes('from') && <div className="text-[10px] text-gray-500 font-medium mt-0.5">{subtext}</div>}
                </div>
            </div>
        </div>
    );
};

// Custom tooltip for charts
const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-dark-100/95 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2.5 shadow-2xl">
                <p className="text-white text-sm font-black uppercase tracking-wider mb-1">
                    {payload[0].payload.name || `Score ${payload[0].payload.score}`}
                </p>
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: payload[0].payload.color || payload[0].fill }} />
                    <p className="text-gray-400 text-xs font-bold">{payload[0].value} <span className="uppercase tracking-widest text-[10px] opacity-70">Anime</span></p>
                </div>
            </div>
        );
    }
    return null;
};

// Activity Heatmap Section
const ActivityHeatmapSection = ({ username, isPrivate }) => {
    const { data: heatmapData, isLoading, isError, refetch } = useQuery({
        queryKey: ['activity-heatmap', username],
        queryFn: () => activityApi.getHeatmap({ username }).then(res => res.data),
        enabled: !isPrivate && !!username,
        staleTime: 5 * 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 p-6 h-full flex items-center justify-center min-h-[300px]">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 p-6 flex flex-col items-center justify-center min-h-[200px] gap-3">
                <p className="text-sm text-gray-500">Failed to load activity heatmap.</p>
                <button
                    onClick={() => refetch()}
                    className="px-4 py-2 rounded-xl bg-dark-100 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-all"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 w-fit mx-auto lg:mx-0">
            <ActivityHeatmap activityData={heatmapData || []} />
        </div>
    );
};

export default function ProfileInsights({ username, isPrivate }) {
    // Fetch all anime lists
    const {
        data: listsData,
        isLoading: listsLoading,
        isError: listsError,
        error: listsErrorDetails,
        refetch: refetchLists
    } = useQuery({
        queryKey: ['profile-insights-lists', username],
        queryFn: async () => {
            const statuses = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
            const results = await Promise.all(
                statuses.map(status =>
                    listApi.getAll({ status, username }).then(res => {
                        const items = res.data?.results || res.data || [];
                        return {
                            status,
                            items: Array.isArray(items) ? items : []
                        };
                    }).catch(err => {
                        console.error(`Failed to fetch list for status ${status}:`, err);
                        return { status, items: [] };
                    })
                )
            );
            return results;
        },
        enabled: !isPrivate && !!username,
        staleTime: 5 * 60 * 1000,
    });

    // Fetch reviews
    const { 
        data: reviewsData, 
        isLoading: reviewsLoading,
        isError: reviewsError,
        refetch: refetchReviews
    } = useQuery({
        queryKey: ['insights-reviews', username],
        queryFn: () => reviewApi.getAll({ user: username }).then(res => res.data.results || res.data || []),
        enabled: !isPrivate && !!username,
    });

    if (isPrivate) {
        return (
            <div className="text-center py-20 bg-dark-100/40 backdrop-blur-xl rounded-3xl border border-white/5">
                <Activity className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 font-bold px-4">Insights are not available for private profiles.</p>
            </div>
        );
    }

    if (listsLoading || reviewsLoading) {
        return (
            <div className="flex flex-col gap-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-28 bg-dark-100/40 backdrop-blur-xl border border-white/5 rounded-2xl" />
                    ))}
                </div>
                <div className="grid lg:grid-cols-2 gap-6 animate-pulse">
                    <div className="h-96 bg-dark-100/40 backdrop-blur-xl border border-white/5 rounded-2xl" />
                    <div className="h-96 bg-dark-100/40 backdrop-blur-xl border border-white/5 rounded-2xl" />
                </div>
            </div>
        );
    }

    // Handle errors gracefully
    if (listsError || reviewsError) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-dark-100/40 backdrop-blur-xl rounded-3xl border border-white/5">
                <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 font-bold mb-4">Failed to load insights.</p>
                <button
                    onClick={() => {
                        if (listsError) refetchLists();
                        if (reviewsError) refetchReviews();
                    }}
                    className="px-6 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:scale-105 transition-transform"
                >
                    Try Again
                </button>
            </div>
        );
    }

    // Safely process list data with defensive checks
    const allItems = Array.isArray(listsData) 
        ? listsData.flatMap(g => Array.isArray(g?.items) ? g.items : []) 
        : [];
    const totalAnime = allItems.length;
    const totalEpisodes = allItems.reduce((sum, item) => sum + (item?.episodes_watched || 0), 0);
    const completedCount = Array.isArray(listsData) 
        ? (listsData.find(g => g?.status === 'Completed')?.items?.length || 0)
        : 0;
    const watchingCount = Array.isArray(listsData) 
        ? (listsData.find(g => g?.status === 'Watching')?.items?.length || 0)
        : 0;

    // Genre distribution - with safe access
    const genreCounts = {};
    allItems.forEach(item => {
        if (item?.anime?.genres && Array.isArray(item.anime.genres)) {
            item.anime.genres.forEach(genre => {
                if (genre?.name) {
                    genreCounts[genre.name] = (genreCounts[genre.name] || 0) + 1;
                }
            });
        }
    });

    const genreData = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, value], index) => ({
            name,
            value,
            color: GENRE_COLORS[index % GENRE_COLORS.length]
        }));

    // Score distribution
    const reviews = Array.isArray(reviewsData) ? reviewsData : [];
    const scoreCounts = {};
    for (let i = 1; i <= 10; i++) scoreCounts[i] = 0;

    reviews.forEach(review => {
        const score = review.rating;
        if (score >= 1 && score <= 10) scoreCounts[score]++;
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
        <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-700 w-full overflow-x-hidden">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                <StatCard icon={Tv} label="Total Anime" value={totalAnime} color="blue" />
                <StatCard icon={Clock} label="Total Episodes" value={totalEpisodes.toLocaleString()} color="accent" />
                <StatCard icon={TrendingUp} label="Completed" value={completedCount} color="green" />
                <StatCard icon={Star} label="Avg Score" value={avgScore} subtext={`from ${reviews.length} reviews`} color="yellow" />
            </div>

            {/* Charts Row */}
            <div className="grid md:grid-cols-2 lg:grid-cols-12 gap-6 items-stretch w-full">
                {/* Anime DNA - 5 cols on desktop, full on mobile, 1 col on tablet */}
                <div className="lg:col-span-5 md:col-span-2 bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 p-4 sm:p-6 flex flex-col min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-white font-black uppercase tracking-widest text-[10px] flex items-center gap-2 mb-1">
                                <BarChart3 className="w-3.5 h-3.5 text-accent" />
                                Anime DNA
                            </h3>
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Your unique taste profile</p>
                        </div>
                    </div>
                    {genreData.length > 0 ? (
                        <div className="flex-1 flex flex-col justify-center gap-6">
                            <div className="h-64 relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart data={genreData} margin={{ top: 0, right: 30, bottom: 0, left: 30 }}>
                                        <PolarGrid stroke="rgba(255,255,255,0.05)" radialLines={true} />
                                        <PolarAngleAxis
                                            dataKey="name"
                                            tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                                        />
                                        <PolarRadiusAxis domain={[0, 'auto']} tick={false} axisLine={false} />
                                        <Radar
                                            name="Genre Profile"
                                            dataKey="value"
                                            stroke="#8b5cf6"
                                            strokeWidth={3}
                                            fill="url(#radarGradient)"
                                            fillOpacity={0.6}
                                            dot={{ r: 4, fill: '#8b5cf6', stroke: '#fff', strokeWidth: 1.5 }}
                                            animationDuration={1500}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        <defs>
                                            <linearGradient id="radarGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                                <stop offset="100%" stopColor="#ec4899" stopOpacity={0.4} />
                                            </linearGradient>
                                        </defs>
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-6 border-t border-white/5">
                                {genreData.slice(0, 6).map((genre) => (
                                    <div key={genre.name} className="flex items-center gap-2 group cursor-default">
                                        <div className="w-2 h-2 rounded-full ring-2 ring-white/5 shadow-lg group-hover:scale-125 transition-transform" style={{ backgroundColor: genre.color }} />
                                        <span className="text-[10px] font-black text-gray-400 group-hover:text-white transition-colors uppercase tracking-widest">{genre.name}</span>
                                        <span className="text-[10px] font-bold text-gray-600">({genre.value})</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-40">
                            <BarChart3 className="w-12 h-12 mb-4 text-gray-700" />
                            <p className="text-sm font-bold text-gray-500 uppercase tracking-[0.2em]">Build your list to see DNA</p>
                        </div>
                    )}
                </div>

                {/* Score Distribution - 7 cols on desktop, full on mobile, 1 col on tablet */}
                <div className="lg:col-span-7 md:col-span-2 bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 p-4 sm:p-6 flex flex-col min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-white font-black uppercase tracking-widest text-[10px] flex items-center gap-2 mb-1">
                                <Star className="w-3.5 h-3.5 text-yellow-500" />
                                Ratings Matrix
                            </h3>
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">How you evaluate anime quality</p>
                        </div>
                        {reviews.length > 0 && (
                            <div className="px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                                <span className="text-[10px] text-yellow-500 font-black uppercase tracking-widest">{avgScore} Average</span>
                            </div>
                        )}
                    </div>
                    {reviews.length > 0 ? (
                        <div className="flex-1 h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={scoreData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <XAxis
                                        dataKey="score"
                                        tick={{ fill: '#6b7280', fontSize: 11, fontWeight: 900 }}
                                        axisLine={false}
                                        tickLine={false}
                                        dy={10}
                                    />
                                    <YAxis
                                        tick={{ fill: '#6b7280', fontSize: 10, fontWeight: 800 }}
                                        axisLine={false}
                                        tickLine={false}
                                        allowDecimals={false}
                                        dx={-10}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                    <Bar
                                        dataKey="count"
                                        radius={[6, 6, 2, 2]}
                                        animationDuration={1500}
                                    >
                                        {scoreData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.fill}
                                                fillOpacity={0.8}
                                                className="hover:fill-opacity-100 transition-all duration-300"
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-40">
                            <Star className="w-12 h-12 mb-4 text-gray-700" />
                            <p className="text-sm font-bold text-gray-500 uppercase tracking-[0.2em]">Write reviews to see distribution</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Row - Activity & Progress */}
            <div className="grid lg:grid-cols-12 md:grid-cols-2 gap-6 items-start w-full">
                {/* Heatmap - 5 cols on desktop */}
                <div className="lg:col-span-5 md:col-span-2 min-w-0 relative z-10">
                    <ActivityHeatmapSection username={username} isPrivate={isPrivate} />
                </div>

                {/* Watching Progress - 7 cols on desktop */}
                <div className="lg:col-span-7 md:col-span-2 bg-dark-100/40 backdrop-blur-xl rounded-2xl border border-white/5 p-4 sm:p-6 flex flex-col min-h-[400px] min-w-0 overflow-hidden">
                    <h3 className="text-white font-black uppercase tracking-widest text-[10px] flex items-center gap-2 mb-6">
                        <Activity className="w-3.5 h-3.5 text-cyan-500" />
                        Live Progress
                    </h3>
                    <div className="flex-1 space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                        {watchingCount > 0 ? (
                            listsData?.find(g => g?.status === 'Watching')?.items?.slice(0, 10).map((item) => {
                                if (!item || !item.anime) return null;
                                const eps = item.episodes_watched || 0;
                                const total = item.anime?.episode_count || 0;
                                const progress = total > 0 ? (eps / total) * 100 : 0;

                                return (
                                    <div key={item.id} className="group relative bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="relative shrink-0">
                                                <img
                                                    src={item.anime?.cover_image}
                                                    alt={item.anime?.title}
                                                    className="w-10 h-14 rounded-lg object-cover shadow-2xl"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-black text-white truncate mb-2 tracking-tight">
                                                    {item.anime?.title}
                                                </p>
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.1em]">
                                                        <span className="text-gray-500">{progress.toFixed(0)}% <span className="text-[8px] opacity-70">Complete</span></span>
                                                        <span className="text-gray-300">{eps} <span className="text-gray-600">/</span> {total || '?'} <span className="text-[8px] opacity-70 font-bold ml-0.5">EPS</span></span>
                                                    </div>
                                                    <div className="relative h-1.5 bg-dark-400 rounded-full overflow-hidden p-[1px] shadow-inner">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-accent to-purple-500 rounded-full transition-all duration-1000 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
                                                            style={{ width: `${progress}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center opacity-30">
                                <Tv className="w-10 h-10 mb-3 text-gray-600" />
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">No active progress</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
