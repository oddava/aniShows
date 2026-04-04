import { Activity, BarChart3, Star, TrendingUp, Users } from 'lucide-react';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import StatusDistribution from './StatusDistribution';
import {
    formatCompactCount,
    getStatusDistributionTotal,
    normalizeStatusDistribution,
} from '../utils/statusDistribution';

function EpisodeRatingsTooltip({ active, payload }) {
    if (!active || !Array.isArray(payload) || payload.length === 0) {
        return null;
    }

    const snapshot = payload[0]?.payload;
    if (!snapshot) {
        return null;
    }

    return (
        <div className="rounded-xl border border-white/10 bg-dark px-3 py-2 shadow-2xl">
            <p className="text-xs font-bold text-white">Episode {snapshot.episodeNumber}</p>
            <p className="mt-1 text-xs text-gray-300">
                Average: {snapshot.average != null ? `${snapshot.average.toFixed(2)} / 5` : 'Unrated'}
            </p>
            <p className="text-xs text-gray-500">
                Votes: {snapshot.votes}
            </p>
        </div>
    );
}

export default function StatsTab({
    anime,
    accentColor,
    episodeRatings = [],
    isEpisodeRatingsLoading = false,
}) {
    const totalPlatformMembers = getStatusDistributionTotal(
        normalizeStatusDistribution(anime?.status_distribution)
    );
    const scoreLabel = anime?.rating != null
        ? (anime?.anilist_id ? 'on AniList' : '/ 10')
        : '';
    const chartAccent = accentColor || '#75698d';
    const chartData = episodeRatings.map((episode) => ({
        episode: `EP ${episode.episode_number}`,
        episodeNumber: episode.episode_number,
        average: episode.average_rating != null ? Number(episode.average_rating) : null,
        votes: Number(episode.rating_count || 0),
    }));
    const ratedEpisodes = chartData.filter((episode) => episode.average != null);
    const averageAcrossSeries = ratedEpisodes.length > 0
        ? ratedEpisodes.reduce((sum, episode) => sum + episode.average, 0) / ratedEpisodes.length
        : null;
    const peakEpisode = ratedEpisodes.reduce((best, episode) => {
        if (!best || episode.average > best.average) {
            return episode;
        }
        return best;
    }, null);
    const totalEpisodeVotes = chartData.reduce((sum, episode) => sum + episode.votes, 0);

    return (
        <div className="animate-tab-content space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard
                    icon={Users}
                    label="Total Members"
                    value={formatCompactCount(totalPlatformMembers)}
                    accentColor={chartAccent}
                />
                <StatCard
                    icon={Star}
                    label="Average Score"
                    value={anime?.rating != null ? anime.rating : 'N/A'}
                    accentColor={chartAccent}
                    subtext={scoreLabel}
                />
                <StatCard
                    icon={TrendingUp}
                    label="Popularity"
                    value={anime?.popularity_rank ? `#${anime.popularity_rank}` : 'N/A'}
                    accentColor={chartAccent}
                />
                <StatCard
                    icon={Activity}
                    label="Site Rank"
                    value={anime?.site_rank ? `#${anime.site_rank}` : 'N/A'}
                    accentColor={chartAccent}
                />
            </div>

            <div className="rounded-2xl border border-gray-800 bg-dark-100/50 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-gray-500" />
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">
                                Episode Ratings
                            </h3>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm text-gray-400">
                            Community scores per episode. Bars show vote volume and the line tracks
                            how the season’s quality curve shifts over time.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-right text-xs sm:text-sm">
                        <div>
                            <p className="text-gray-500">Rated Episodes</p>
                            <p className="font-semibold text-white">{ratedEpisodes.length}</p>
                        </div>
                        <div>
                            <p className="text-gray-500">Total Votes</p>
                            <p className="font-semibold text-white">{totalEpisodeVotes}</p>
                        </div>
                        <div>
                            <p className="text-gray-500">Series Avg</p>
                            <p className="font-semibold text-white">
                                {averageAcrossSeries != null ? `${averageAcrossSeries.toFixed(2)} / 5` : 'N/A'}
                            </p>
                        </div>
                        <div>
                            <p className="text-gray-500">Peak Episode</p>
                            <p className="font-semibold text-white">
                                {peakEpisode ? `EP ${peakEpisode.episodeNumber}` : 'N/A'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-6 h-[320px]">
                    {isEpisodeRatingsLoading ? (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-dark-200/30 text-sm text-gray-500">
                            Loading episode ratings...
                        </div>
                    ) : ratedEpisodes.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                                <XAxis
                                    dataKey="episode"
                                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                                    minTickGap={20}
                                />
                                <YAxis
                                    yAxisId="ratings"
                                    domain={[0, 5]}
                                    ticks={[0, 1, 2, 3, 4, 5]}
                                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                                    stroke="rgba(255,255,255,0.08)"
                                />
                                <YAxis
                                    yAxisId="votes"
                                    orientation="right"
                                    allowDecimals={false}
                                    tick={{ fill: '#6b7280', fontSize: 11 }}
                                    stroke="rgba(255,255,255,0.08)"
                                />
                                <RechartsTooltip content={<EpisodeRatingsTooltip />} />
                                {averageAcrossSeries != null && (
                                    <ReferenceLine
                                        yAxisId="ratings"
                                        y={averageAcrossSeries}
                                        stroke="rgba(255,255,255,0.16)"
                                        strokeDasharray="4 4"
                                    />
                                )}
                                <Bar
                                    yAxisId="votes"
                                    dataKey="votes"
                                    fill={chartAccent}
                                    fillOpacity={0.18}
                                    radius={[8, 8, 0, 0]}
                                    barSize={18}
                                />
                                <Line
                                    yAxisId="ratings"
                                    type="monotone"
                                    dataKey="average"
                                    stroke={chartAccent}
                                    strokeWidth={3}
                                    dot={{ r: 3, fill: chartAccent, strokeWidth: 0 }}
                                    activeDot={{ r: 5, fill: chartAccent, strokeWidth: 0 }}
                                    connectNulls={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-dark-200/30 text-center text-sm text-gray-500">
                            No episode ratings yet. Community scores will appear here as users rate episodes.
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatusDistribution anime={anime} />

                <div className="bg-dark-100/50 rounded-2xl p-6 border border-gray-800">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-4 h-4 text-gray-500" />
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">
                            Rankings
                        </h3>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Site Rank</span>
                            <span className="text-white font-medium">
                                {anime?.site_rank ? `#${anime.site_rank}` : 'N/A'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Popularity Rank</span>
                            <span className="text-white font-medium">
                                {anime?.popularity_rank ? `#${anime.popularity_rank}` : 'N/A'}
                            </span>
                        </div>
                        {anime?.trending_rank && (
                            <div className="flex justify-between">
                                <span className="text-gray-400">Trending Rank</span>
                                <span className="text-white font-medium">
                                    #{anime.trending_rank}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, subtext, accentColor }) {
    return (
        <div className="bg-dark-100/50 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <Icon
                className="w-5 h-5 mb-2"
                style={{ color: accentColor }}
            />
            <p className="text-2xl font-black text-white">
                {value}
                {subtext ? <span className="text-sm font-normal text-gray-400 ml-1">{subtext}</span> : ''}
            </p>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.12em]">{label}</p>
        </div>
    );
}
