import { useQuery } from '@tanstack/react-query';
import { Cell, BarChart, Bar, LabelList, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import { getProfileAccentTheme, normalizeProfilePrimaryColor } from '../utils/profileAccent';
import { LIST_STATUSES } from '../utils/listStatus';
import { profileScore } from './profile/profileStats';
import { listQueries } from '../api/queries/lists';

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
        <div className="rounded-[var(--radius-md)] bg-[var(--ink-3)] px-3.5 py-2.5 shadow-lg shadow-black/30">
            <p className="text-[13px] font-medium text-[var(--text-1)]">{row.name || `Scored ${row.score}`}</p>
            <p className="text-[13px] text-[var(--text-2)] tabular">{payload[0].value} {unit}</p>
        </div>
    );
};

/** A section on its own soft panel: a title, an optional muted line, then the content. */
function Section({ title, note, children }) {
    return (
        <section className="panel min-w-0">
            <h2 className="section-title">{title}</h2>
            {note && <p className="mt-1 text-[15px] text-[var(--text-2)]">{note}</p>}
            <div className="mt-5">{children}</div>
        </section>
    );
}

/** Top genres as a ranked list, each with a bar in the profile accent. */
function GenreBars({ genres, color }) {
    const max = Math.max(...genres.map((genre) => genre.value), 1);
    return (
        <ol className="space-y-3.5">
            {genres.map((genre) => (
                <li key={genre.name} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.5rem] items-center gap-4 text-[15px]">
                    <span className="truncate text-[var(--text-1)]">{genre.name}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">
                        <span
                            className="block h-full rounded-full"
                            style={{ width: `${Math.max((genre.value / max) * 100, 4)}%`, backgroundColor: color }}
                        />
                    </span>
                    <span className="text-right text-[var(--text-2)] tabular">{genre.value}</span>
                </li>
            ))}
        </ol>
    );
}

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

    if (isPrivate) {
        return <p className="text-[17px] text-[var(--text-2)]">This profile is private, so its stats are too.</p>;
    }

    if (summaryLoading) {
        return (
            <div className="space-y-4" aria-hidden="true">
                <div className="h-28 rounded-[var(--radius-lg)] bg-[var(--ink-1)] animate-pulse" />
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="h-72 rounded-[var(--radius-lg)] bg-[var(--ink-1)] animate-pulse" />
                    <div className="h-72 rounded-[var(--radius-lg)] bg-[var(--ink-1)] animate-pulse" />
                </div>
            </div>
        );
    }

    if (summaryError) {
        return (
            <p className="text-[17px] text-[var(--text-2)]">
                Couldn’t load these stats.{' '}
                <button
                    type="button"
                    className="text-link"
                    onClick={() => refetchSummary()}
                >
                    Try again
                </button>
            </p>
        );
    }

    const totalAnime = summary?.total || 0;
    const totalEpisodes = summary?.episodes_watched || 0;

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
    // The tallest bar fills the chart: the scale tops out at the largest
    // count, and each bar carries its own number instead of a y-axis.
    const maxScoreCount = Math.max(...scoreData.map((entry) => entry.count), 1);
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
        <div className="w-full space-y-4 pb-8">
            <dl className="panel flex flex-wrap gap-x-12 gap-y-5">
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
                    <div className="flex h-2 w-full gap-1 overflow-hidden rounded-full" aria-hidden="true">
                        {statusCounts.map((status) => (
                            <span
                                key={status.value}
                                className="rounded-full"
                                style={{ flex: `${status.count} 1 0%`, backgroundColor: status.color }}
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
                <div className="grid items-start gap-4 lg:grid-cols-2">
                    {genreData.length > 0 && (
                        <Section title="Genres" note="What the list leans towards">
                            <GenreBars genres={genreData} color={profileAccentColor} />
                        </Section>
                    )}

                    {ratedCount > 0 && (
                        <Section title="Scores" note={`Mean ${mean} from ${ratedCount} rated`}>
                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={scoreData} margin={{ top: 24, right: 0, left: 0, bottom: 0 }}>
                                        <XAxis dataKey="score" tick={AXIS_TICK} axisLine={false} tickLine={false} dy={8} />
                                        <YAxis hide domain={[0, maxScoreCount]} allowDataOverflow />
                                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                                        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                            {scoreData.map((entry) => (
                                                <Cell key={entry.score} fill={entry.fill} />
                                            ))}
                                            <LabelList
                                                dataKey="count"
                                                position="top"
                                                offset={8}
                                                fill="#a3abb6"
                                                fontSize={13}
                                                className="tabular"
                                                formatter={(value) => (value > 0 ? value : '')}
                                            />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Section>
                    )}
                </div>
            )}
        </div>
    );
}
