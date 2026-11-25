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
        <div className="rounded-[var(--radius-md)] bg-[var(--ink-2)] px-3 py-2 shadow-[var(--shadow-pop)]">
            <p className="text-sm font-medium text-[var(--text-1)]">Episode {snapshot.episodeNumber}</p>
            <p className="mt-1 text-sm text-[var(--text-2)]">
                {snapshot.average != null ? `${snapshot.average.toFixed(2)} / 5` : 'Unrated'} · {snapshot.votes} votes
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
    // D-3: `status_distribution` is AniList's; `site_status_distribution` (when the
    // payload has it) is AniShows' own lists.
    const totalPlatformMembers = getStatusDistributionTotal(
        normalizeStatusDistribution(anime?.status_distribution)
    );
    const siteDistribution = anime?.site_status_distribution;
    const scoreLabel = anime?.rating != null
        ? (anime?.anilist_id ? '/ 10 on AniList' : '/ 10')
        : '';
    // recharts needs a literal colour: the signature accent (--signature).
    const chartAccent = accentColor || '#8db1ff';
    const chartData = episodeRatings.map((episode) => ({
        episode: `${episode.episode_number}`,
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

    const hasScore = anime?.rating != null && anime.rating !== '' && Number(anime.rating) > 0;
    const stats = [
        totalPlatformMembers > 0 && { label: 'Total members', value: formatCompactCount(totalPlatformMembers), subtext: 'on AniList' },
        hasScore && { label: 'Average score', value: anime.rating, subtext: scoreLabel },
        anime?.popularity_rank && { label: 'Popularity', value: `#${anime.popularity_rank}` },
        anime?.site_rank && { label: 'Site rank', value: `#${anime.site_rank}` },
        anime?.trending_rank && { label: 'Trending', value: `#${anime.trending_rank}` },
    ].filter(Boolean);

    return (
        <div className="animate-tab-content space-y-4">
            {stats.length > 0 && (
                <div className="panel grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
                    {stats.map((stat) => (
                        <StatCard key={stat.label} {...stat} />
                    ))}
                </div>
            )}

            <section className="panel">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <h2 className="section-title">Episode ratings</h2>
                    {ratedEpisodes.length > 0 && (
                        <p className="text-sm text-[var(--text-2)] tabular">
                            {ratedEpisodes.length} rated · {totalEpisodeVotes} votes
                            {averageAcrossSeries != null && ` · ${averageAcrossSeries.toFixed(2)} / 5 average`}
                            {peakEpisode && ` · best: episode ${peakEpisode.episodeNumber}`}
                        </p>
                    )}
                </div>

                {isEpisodeRatingsLoading ? (
                    <p className="mt-4 text-[15px] text-[var(--text-2)]">Loading episode ratings…</p>
                ) : ratedEpisodes.length > 0 ? (
                    <div className="mt-6 h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                                <XAxis
                                    dataKey="episode"
                                    tick={{ fill: '#a3abb6', fontSize: 12 }}
                                    minTickGap={20}
                                />
                                <YAxis
                                    yAxisId="ratings"
                                    domain={[0, 5]}
                                    ticks={[0, 1, 2, 3, 4, 5]}
                                    tick={{ fill: '#a3abb6', fontSize: 12 }}
                                    stroke="rgba(255,255,255,0.08)"
                                />
                                <YAxis
                                    yAxisId="votes"
                                    orientation="right"
                                    allowDecimals={false}
                                    tick={{ fill: '#878f9b', fontSize: 12 }}
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
                                    radius={[4, 4, 0, 0]}
                                    barSize={18}
                                />
                                <Line
                                    yAxisId="ratings"
                                    type="monotone"
                                    dataKey="average"
                                    stroke={chartAccent}
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: chartAccent, strokeWidth: 0 }}
                                    activeDot={{ r: 5, fill: chartAccent, strokeWidth: 0 }}
                                    connectNulls={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <p className="mt-4 text-[15px] text-[var(--text-2)]">
                        No episode ratings yet. Rate episodes on the Watch tab and they show up here.
                    </p>
                )}
            </section>

            <div className="grid grid-cols-1 gap-12 md:grid-cols-2">
                <StatusDistribution anime={anime} />
                {siteDistribution ? (
                    <StatusDistribution
                        distribution={siteDistribution}
                        sourceLabel="On AniShows"
                    />
                ) : null}
            </div>
        </div>
    );
}

function StatCard({ label, value, subtext }) {
    return (
        <div>
            <p className="tabular text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-1)]">
                {value}
                {subtext ? <span className="ml-1.5 text-sm font-normal text-[var(--text-3)]">{subtext}</span> : ''}
            </p>
            <p className="mt-1 text-sm text-[var(--text-2)]">{label}</p>
        </div>
    );
}
