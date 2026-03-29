import { useQuery } from '@tanstack/react-query';
import { listApi, reviewApi, activityApi } from '../api/client';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { TrendingUp, Star, Tv, Clock, BarChart3, Activity } from 'lucide-react';
import ActivityHeatmap from './ActivityHeatmap';
import AnimeMediaImage from './common/AnimeMediaImage';

const DEFAULT_PROFILE_PRIMARY_COLOR = '#75698d';

function normalizeProfilePrimaryColor(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_PROFILE_PRIMARY_COLOR;
}

function adjustHexBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const red = Math.min(255, Math.max(0, (num >> 16) + amt));
    const green = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
    const blue = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
    return `#${(0x1000000 + red * 0x10000 + green * 0x100 + blue).toString(16).slice(1)}`;
}

function hexToRgb(hex) {
    const normalized = normalizeProfilePrimaryColor(hex).replace('#', '');
    return {
        red: parseInt(normalized.slice(0, 2), 16),
        green: parseInt(normalized.slice(2, 4), 16),
        blue: parseInt(normalized.slice(4, 6), 16),
    };
}

function toRgba(hex, alpha) {
    const { red, green, blue } = hexToRgb(hex);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Color palette for charts
const GENRE_COLORS = [
    '#75698d', '#c47292', '#4f88a8', '#4f8d74', '#b88a52',
    '#ef4444', '#3b82f6', '#a855f7', '#14b8a6', '#f97316'
];

// Flat Stat Card stripped of Icons and Gradients
const StatCard = ({ icon: Icon, label, value, subtext, color = 'accent' }) => {
    return (
        <div className="bg-dark-100/50 rounded-xl border border-gray-800 p-6">
            <div className="flex flex-col gap-1">
                <div className="text-xs text-gray-500 font-bold uppercase tracking-[0.16em] mb-4">{label}</div>
                <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-black text-white tracking-tight">{value}</div>
                    {subtext && <span className="text-xs text-gray-500 font-bold uppercase tracking-[0.16em] opacity-60">{subtext}</span>}
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
const ActivityHeatmapSection = ({ username, isPrivate, accentColor }) => {
    const { data: heatmapData, isLoading, isError, refetch } = useQuery({
        queryKey: ['activity-heatmap', username],
        queryFn: () => activityApi.getHeatmap({ username }).then(res => res.data),
        enabled: !isPrivate && !!username,
        staleTime: 5 * 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="bg-dark-100/50 rounded-xl border border-gray-800 p-6 h-full flex items-center justify-center min-h-[300px]">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="bg-dark-100/50 rounded-xl border border-gray-800 p-6 flex flex-col items-center justify-center min-h-[200px] gap-3">
                <p className="text-sm text-gray-500">Failed to load activity heatmap.</p>
                <button
                    onClick={() => refetch()}
                    className="px-4 py-2 rounded-xl bg-dark-100 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="bg-dark-100/50 rounded-xl border border-gray-800 w-full overflow-hidden mx-auto lg:mx-0">
            <ActivityHeatmap activityData={heatmapData || []} accentColor={accentColor} />
        </div>
    );
};

export default function ProfileInsights({ username, isPrivate, accentColor }) {
    const profileAccentColor = normalizeProfilePrimaryColor(accentColor);
    const profileAccentLight = adjustHexBrightness(profileAccentColor, 18);
    const profileAccentDark = adjustHexBrightness(profileAccentColor, -18);

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
            <div className="text-center py-20 bg-dark-100/50 rounded-xl border border-gray-800">
                <p className="text-gray-400 font-bold px-4">Insights are not available for private profiles.</p>
            </div>
        );
    }

    if (listsLoading || reviewsLoading) {
        return (
            <div className="flex flex-col gap-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-28 bg-dark-100/50 rounded-xl border border-gray-800" />
                    ))}
                </div>
                <div className="grid lg:grid-cols-2 gap-6 animate-pulse">
                    <div className="h-96 bg-dark-100/50 rounded-xl border border-gray-800" />
                    <div className="h-96 bg-dark-100/50 rounded-xl border border-gray-800" />
                </div>
            </div>
        );
    }

    // Handle errors gracefully
    if (listsError || reviewsError) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-dark-100/50 rounded-xl border border-gray-800">
                <p className="text-gray-400 font-bold mb-4">Failed to load insights.</p>
                <button
                    onClick={() => {
                        if (listsError) refetchLists();
                        if (reviewsError) refetchReviews();
                    }}
                    className="btn-primary px-6 py-2.5 text-sm"
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
            fill:
                parseInt(score) >= 9
                    ? profileAccentColor
                    : parseInt(score) >= 7
                        ? profileAccentLight
                        : parseInt(score) >= 5
                            ? toRgba(profileAccentColor, 0.7)
                            : parseInt(score) >= 3
                                ? toRgba(profileAccentDark, 0.8)
                                : profileAccentDark
        }))
        .sort((a, b) => a.score - b.score);

    const avgScore = reviews.length > 0
        ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
        : '-';

    return (
        <div className="w-full space-y-6 overflow-x-hidden lg:space-y-8">
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
                <div className="lg:col-span-5 md:col-span-2 bg-dark-100/50 rounded-xl border border-gray-800 p-4 sm:p-6 flex flex-col min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-1">
                                Anime DNA
                            </h3>
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.16em] opacity-60 uppercase">Your unique taste profile</p>
                        </div>
                    </div>
                    {genreData.length > 0 ? (
                        <div className="flex-1 flex flex-col justify-center gap-6">
                            <div className="h-64 relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart data={genreData} margin={{ top: 0, right: 30, bottom: 0, left: 30 }}>
                                        <PolarGrid stroke="var(--color-border-soft)" radialLines={true} />
                                        <PolarAngleAxis
                                            dataKey="name"
                                            tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                                        />
                                        <PolarRadiusAxis domain={[0, 'auto']} tick={false} axisLine={false} />
                                        <Radar
                                            name="Genre Profile"
                                            dataKey="value"
                                            stroke={profileAccentColor}
                                            strokeWidth={3}
                                            fill={profileAccentColor}
                                            fillOpacity={0.3}
                                            dot={{ r: 4, fill: profileAccentColor, stroke: '#fff', strokeWidth: 1.5 }}
                                            animationDuration={1500}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-6 border-t border-white/5">
                                {genreData.slice(0, 6).map((genre) => (
                                    <div key={genre.name} className="flex cursor-default items-center gap-2">
                                        <div className="h-2 w-2 rounded-full ring-2 ring-white/5" style={{ backgroundColor: genre.color }} />
                                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">{genre.name}</span>
                                        <span className="text-[10px] font-bold text-gray-600">({genre.value})</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-40">
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">Build your list to see DNA</p>
                        </div>
                    )}
                </div>

                {/* Score Distribution - 7 cols on desktop, full on mobile, 1 col on tablet */}
                <div className="lg:col-span-7 md:col-span-2 bg-dark-100/50 rounded-xl border border-gray-800 p-4 sm:p-6 flex flex-col min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-1">
                                Ratings Matrix
                            </h3>
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.16em] opacity-60 uppercase">How you evaluate anime quality</p>
                        </div>
                        {reviews.length > 0 && (
                            <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-accent">
                                    {avgScore} Average
                                </span>
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
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-overlay-soft)' }} />
                                    <Bar
                                        dataKey="count"
                                        radius={[6, 6, 0, 0]}
                                        animationDuration={1500}
                                    >
                                        {scoreData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.fill}
                                                fillOpacity={0.8}
                                                className="hover:fill-opacity-100 transition-opacity duration-300"
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-40">
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">Write reviews to see distribution</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Row - Activity & Progress */}
            <div className="grid lg:grid-cols-12 md:grid-cols-2 gap-6 items-start w-full">
                {/* Heatmap - 5 cols on desktop */}
                <div className="lg:col-span-5 md:col-span-2 min-w-0 relative z-10">
                    <ActivityHeatmapSection
                        username={username}
                        isPrivate={isPrivate}
                        accentColor={profileAccentColor}
                    />
                </div>

                {/* Watching Progress - 7 cols on desktop */}
                <div className="lg:col-span-7 md:col-span-2 bg-dark-100/50 rounded-xl border border-gray-800 p-4 sm:p-6 flex flex-col min-h-[400px] min-w-0 overflow-hidden">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-6">
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
                                                <AnimeMediaImage
                                                    anime={item.anime}
                                                    kind="cover"
                                                    size="small"
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
                                                            className="h-full bg-accent transition-[width] duration-1000"
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
                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">No active progress</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
