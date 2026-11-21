import { useQuery } from '@tanstack/react-query';
import { Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { Link } from 'react-router-dom';
import ActivityHeatmap from './ActivityHeatmap';
import AnimeMediaImage from './common/AnimeMediaImage';
import { getProfileAccentTheme, normalizeProfilePrimaryColor } from '../utils/profileAccent';
import { LIST_STATUSES } from '../utils/listStatus';
import { knownEpisodeTotal } from '../utils/episodes';
import { profileScore } from './profile/profileStats';
import { activityQueries, insightsQueries, listQueries } from '../api/queries/lists';

function toRgba(hex, alpha) {
    const normalized = normalizeProfilePrimaryColor(hex).replace('#', '');
    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const AXIS_TICK = { fill: '#a3abb6', fontSize: 13 };

const ChartTooltip = ({ active, payload, unit = 'anime' }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
        <div className="rounded-[var(--radius-md)] border border-white/[0.08] bg-[var(--ink-3)] px-3.5 py-2.5 shadow-lg shadow-black/30">
            <p className="text-[13px] font-medium text-[var(--text-1)]">{row.name || `Scored ${row.score}`}</p>
            <p className="text-[13px] text-[var(--text-2)] tabular">{payload[0].value} {unit}</p>
        </div>
    );
};

/** A section: a title, an optional muted line, then the content. Hairline between sections. */
function Section({ title, note, children }) {
    return (
        <section className="min-w-0">
            <h2 className="section-title">{title}</h2>
            {note && <p className="mt-1 text-[15px] text-[var(--text-2)]">{note}</p>}
            <div className="mt-5">{children}</div>
        </section>
    );
}

const ActivitySection = ({ username, isPrivate, accentColor }) => {
    const { data: heatmapData, isLoading, isError, refetch } = useQuery({
        ...activityQueries.heatmap(username),
        enabled: !isPrivate && !!username,
        staleTime: 5 * 60 * 1000,
    });

    if (isLoading) return <div className="h-40 rounded-[var(--radius-md)] bg-[var(--ink-1)] animate-pulse" aria-hidden="true" />;
    if (isError) {
        return (
            <p className="text-[15px] text-[var(--text-2)]">
                Couldn’t load the activity.{' '}
                <button type="button" onClick={() => refetch()} className="text-link">Try again</button>
            </p>
        );
    }
    return <ActivityHeatmap activityData={heatmapData || []} accentColor={accentColor} />;
};

export default function ProfileInsights({ username, isPrivate, accentColor }) {
    const { baseColor: profileAccentColor, darkColor: profileAccentDark } = getProfileAccentTheme(accentColor);

    // Counts, totals, genres and the score histogram: one summary request.
    const {
        data: summary,
        isLoading: summaryLoading,
        isError: summaryError,
        refetch: refetchSummary,
    } = useQuery({
        ...listQueries.summary(username),
        enabled: !isPrivate && !!username,
        staleTime: 5 * 60 * 1000,
    });

    // "Watching": the ten most recently updated Watching entries.
    const {
        data: watchingItems,
        isLoading: watchingLoading,
        isError: watchingError,
        refetch: refetchWatching,
    } = useQuery({
        ...insightsQueries.watching(username),
        enabled: !isPrivate && !!username,
        staleTime: 5 * 60 * 1000,
    });

    if (isPrivate) {
        return <p className="text-[17px] text-[var(--text-2)]">This profile is private, so its stats are too.</p>;
    }

    if (summaryLoading || watchingLoading) {
        return (
            <div className="space-y-8" aria-hidden="true">
                <div className="h-16 rounded-[var(--radius-md)] bg-[var(--ink-1)] animate-pulse" />
                <div className="grid gap-10 lg:grid-cols-2">
                    <div className="h-72 rounded-[var(--radius-md)] bg-[var(--ink-1)] animate-pulse" />
                    <div className="h-72 rounded-[var(--radius-md)] bg-[var(--ink-1)] animate-pulse" />
                </div>
            </div>
        );
    }

    if (summaryError || watchingError) {
        return (
            <p className="text-[17px] text-[var(--text-2)]">
                Couldn’t load these stats.{' '}
                <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                        if (summaryError) refetchSummary();
                        if (watchingError) refetchWatching();
                    }}
                >
                    Try again
                </button>
            </p>
        );
    }

    const totalAnime = summary?.total || 0;
    const totalEpisodes = summary?.episodes_watched || 0;
    const watching = Array.isArray(watchingItems) ? watchingItems.filter((item) => item?.anime) : [];

    const genreData = (summary?.top_genres || [])
        .slice(0, 8)
        .map((genre) => ({ name: genre.name, value: genre.count }));

    const histogram = summary?.score_histogram || {};
    const scoreData = Array.from({ length: 10 }, (_, index) => {
        const score = index + 1;
        return {
            score,
            count: Number(histogram[score] ?? histogram[String(score)] ?? 0),
            fill: score >= 9
                ? profileAccentColor
                : score >= 7
                    ? toRgba(profileAccentColor, 0.75)
                    : score >= 5
                        ? toRgba(profileAccentColor, 0.5)
                        : toRgba(profileAccentDark, 0.5),
        };
    });
    // Same source as the overview's line: the summary's own rated_count.
    const { mean, rated: ratedCount } = profileScore(null, summary);

    const statusCounts = LIST_STATUSES
        .map((status) => ({ ...status, count: Number(summary?.counts?.[status.value]) || 0 }))
        .filter((status) => status.count > 0);

    const numbers = [
        { label: 'on the list', value: totalAnime },
        { label: 'episodes watched', value: totalEpisodes },
        { label: mean != null ? `mean score of ${ratedCount} rated` : null, value: mean },
    ].filter((entry) => entry.label && entry.value);

    if (totalAnime === 0) {
        return (
            <p className="pb-8 text-[17px] text-[var(--text-2)]">
                No stats yet. They fill in once there are shows on the list.{' '}
                <Link to="/browse?sort=trending" className="text-link">Find something to watch</Link>
            </p>
        );
    }

    return (
        <div className="w-full space-y-10 pb-8 [&>*+*]:border-t [&>*+*]:border-white/[0.06] [&>*+*]:pt-8">
            <dl className="flex flex-wrap gap-x-12 gap-y-5">
                {numbers.map((entry) => (
                    <div key={entry.label} className="flex flex-col-reverse">
                        <dt className="mt-2 text-[15px] text-[var(--text-2)]">{entry.label}</dt>
                        <dd className="text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[var(--text-1)] tabular">
                            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                        </dd>
                    </div>
                ))}
            </dl>

            {statusCounts.length > 0 && (
                <Section title="By status">
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">
                        {statusCounts.map((status) => (
                            <span
                                key={status.value}
                                style={{ width: `${(status.count / totalAnime) * 100}%`, backgroundColor: status.color }}
                            />
                        ))}
                    </div>
                    <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
                        {statusCounts.map((status) => (
                            <li key={status.value} className="flex items-center gap-2 text-[var(--text-2)]">
                                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
                                {status.label}
                                <span className="text-[var(--text-1)] tabular">{status.count}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {(genreData.length > 0 || ratedCount > 0) && (
                <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                    {genreData.length > 0 && (
                        <Section title="Genres" note="What the list leans towards">
                            {genreData.length >= 3 ? (
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart data={genreData} margin={{ top: 0, right: 36, bottom: 0, left: 36 }}>
                                            <PolarGrid stroke="rgba(255,255,255,0.08)" />
                                            <PolarAngleAxis dataKey="name" tick={AXIS_TICK} />
                                            <PolarRadiusAxis domain={[0, 'auto']} tick={false} axisLine={false} />
                                            <Radar
                                                name="Genres"
                                                dataKey="value"
                                                stroke={profileAccentColor}
                                                strokeWidth={2}
                                                fill={profileAccentColor}
                                                fillOpacity={0.2}
                                                isAnimationActive={false}
                                            />
                                            <Tooltip content={<ChartTooltip />} />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : null}
                            <ul className={genreData.length >= 3 ? 'mt-4' : ''}>
                                {genreData.map((genre) => (
                                    <li
                                        key={genre.name}
                                        className="flex items-baseline justify-between gap-4 py-2.5 text-[15px] "
                                    >
                                        <span className="text-[var(--text-1)]">{genre.name}</span>
                                        <span className="text-[var(--text-2)] tabular">{genre.value}</span>
                                    </li>
                                ))}
                            </ul>
                        </Section>
                    )}

                    {ratedCount > 0 && (
                        <Section title="Scores" note={`Mean ${mean} from ${ratedCount} rated`}>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={scoreData} margin={{ top: 8, right: 0, left: -24, bottom: 0 }}>
                                        <XAxis dataKey="score" tick={AXIS_TICK} axisLine={false} tickLine={false} dy={8} />
                                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                                        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                            {scoreData.map((entry) => (
                                                <Cell key={entry.score} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Section>
                    )}
                </div>
            )}

            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                <Section title="Activity">
                    <ActivitySection username={username} isPrivate={isPrivate} accentColor={profileAccentColor} />
                </Section>

                {watching.length > 0 && (
                    <Section title="Watching">
                        <ul>
                            {watching.map((item) => {
                                const eps = item.episodes_watched || 0;
                                const total = knownEpisodeTotal(item.anime);
                                const progress = total > 0 ? Math.min(eps / total, 1) * 100 : 0;
                                return (
                                    <li key={item.id} className="flex items-center gap-4 py-3 ">
                                        <AnimeMediaImage
                                            anime={item.anime}
                                            kind="cover"
                                            size="small"
                                            alt=""
                                            className="h-14 w-10 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <Link
                                                to={`/anime/${item.anime.slug}`}
                                                className="line-clamp-1 text-[15px] font-medium text-[var(--text-1)] hover:text-[var(--signature)]"
                                            >
                                                {item.anime.title}
                                            </Link>
                                            {total > 0 && (
                                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                                                    <div className="h-full rounded-full bg-[var(--signature)]" style={{ width: `${progress}%` }} />
                                                </div>
                                            )}
                                        </div>
                                        <span className="shrink-0 text-sm text-[var(--text-2)] tabular">
                                            {total ? `${eps} of ${total}` : `${eps} watched`}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </Section>
                )}
            </div>
        </div>
    );
}
