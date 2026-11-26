import { ChevronRight } from 'lucide-react';
import { LIST_STATUSES } from '../../../utils/listStatus';
import { statAura } from './statAura';

function compact(value) {
    if (value >= 10000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
    return Math.round(value).toLocaleString();
}

// Where the sparks rise from (x across the number; a little past its
// edges too), when, and which way they drift. A tier lights tier + 2 of
// them: three at green, seven at ruby. Fixed, so the pattern is the same
// on every visit.
const SPARKS = [
    { x: '8%', delay: '0s', dx: '-4px', d: '2.6s' },
    { x: '82%', delay: '1.1s', dx: '3px', d: '2.9s' },
    { x: '46%', delay: '1.9s', dx: '-2px', d: '2.7s' },
    { x: '102%', delay: '0.6s', dx: '5px', d: '3s' },
    { x: '-6%', delay: '1.5s', dx: '-5px', d: '2.8s' },
    { x: '64%', delay: '2.3s', dx: '4px', d: '2.5s' },
    { x: '28%', delay: '0.9s', dx: '-3px', d: '3.1s' },
];

/**
 * One figure, centred over its label, the way a game lobby shows its
 * counters: light digits lit in the tier's colour on a still round glow
 * that hugs them, a soft prismatic rim around that glow, and sparks rising
 * and fading (more as the tier climbs). Tier 0 is plain.
 */
function AuraStat({ label, value, display, metric }) {
    const aura = statAura(metric, value);
    return (
        <div
            className="flex min-w-0 flex-col items-center text-center"
            title={aura.tier ? `${aura.name} aura` : undefined}
        >
            <dt className="sr-only">{label}</dt>
            <dd
                className="profile-stat-value tabular"
                data-aura={aura.tier || undefined}
                style={aura.color ? { '--aura': aura.color } : undefined}
            >
                {aura.tier ? (
                    <span className="profile-aura">
                        {display}
                        {SPARKS.slice(0, aura.tier + 2).map((spark) => (
                            <i
                                key={spark.x}
                                aria-hidden="true"
                                className="profile-aura__spark"
                                style={{ '--x': spark.x, '--delay': spark.delay, '--dx': spark.dx, '--d': spark.d }}
                            />
                        ))}
                    </span>
                ) : display}
            </dd>
            <dd aria-hidden="true" className="mt-1 whitespace-nowrap text-[12px] leading-tight text-[var(--text-3)] sm:text-[13px]">{label}</dd>
        </div>
    );
}

/**
 * The numbers: four running totals, each with an aura whose colour climbs
 * with the number (green, blue, purple, gold, ruby), and the list by status
 * as one split bar with a key that opens each part, beside them when
 * the card is wide enough.
 */
export default function StatsStrip({ user, summary, onOpenStatus, onOpenStats }) {
    const total = Number(summary?.total ?? user?.anime_count) || 0;
    const episodes = Number(summary?.episodes_watched ?? user?.episodes_watched) || 0;
    const minutes = Number(summary?.minutes) || 0;
    const days = minutes ? minutes / 1440 : Number(user?.days_watched) || 0;
    const counts = summary?.counts || {};
    const completed = Number(counts.Completed) || 0;

    const stats = [
        { metric: 'anime', label: 'Anime', value: total, display: compact(total) },
        { metric: 'episodes', label: 'Episodes', value: episodes, display: compact(episodes) },
        {
            metric: 'days',
            label: 'Days watched',
            value: days,
            display: days >= 100 ? Math.round(days).toLocaleString() : days.toFixed(1),
        },
        { metric: 'completed', label: 'Completed', value: completed, display: compact(completed) },
    ];

    const statuses = LIST_STATUSES
        .map((status) => ({ ...status, count: Number(counts[status.value]) || 0 }))
        .filter((status) => status.count > 0);
    const statusTotal = statuses.reduce((sum, status) => sum + status.count, 0);

    return (
        <section aria-labelledby="profile-stats-title" className="profile-card @container">
            <div className="mb-4 flex items-center justify-between gap-4">
                <h2 id="profile-stats-title" className="profile-card-title">Stats</h2>
                {onOpenStats && (
                    <button
                        type="button"
                        onClick={onOpenStats}
                        className="-my-2 inline-flex min-h-[2.75rem] items-center gap-0.5 text-sm font-medium text-[var(--signature)] transition-colors hover:text-[var(--signature-hover)]"
                    >
                        See all
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* The four figures in equal columns, so they sit evenly; on a wide
                card the list by status rides beside them instead of below. */}
            <div className="grid gap-5 @2xl:grid-cols-[auto_minmax(0,1fr)] @2xl:items-center @2xl:gap-10">
                <dl className="grid grid-cols-4 gap-2 py-1 @md:grid-cols-[repeat(4,5.75rem)] @md:gap-3">
                    {stats.map((stat) => <AuraStat key={stat.metric} {...stat} />)}
                </dl>

                {/* One bar split by count, its key below; each status opens
                    the list there. */}
                {statusTotal > 0 && (
                    <div className="min-w-0">
                        <div
                            role="img"
                            aria-label={`On the list: ${statuses.map((status) => `${status.label} ${status.count}`).join(', ')}`}
                            className="flex h-2.5 gap-[3px] overflow-hidden rounded-full"
                        >
                            {statuses.map((status) => (
                                <span
                                    key={status.value}
                                    className="h-full first:rounded-l-full last:rounded-r-full"
                                    style={{ flexGrow: status.count, flexBasis: 0, minWidth: '6px', backgroundColor: status.color }}
                                />
                            ))}
                        </div>
                        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-0.5">
                            {statuses.map((status) => (
                                <li key={status.value}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenStatus?.(status.value)}
                                        className="-mx-1.5 inline-flex min-h-8 items-center gap-2 rounded-md px-1.5 text-[13px] text-[var(--text-2)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text-1)] @2xl:min-h-7"
                                    >
                                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: status.color }} />
                                        {status.label}
                                        <span className="text-[var(--text-1)] tabular">{status.count.toLocaleString()}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}
