import { CheckCheck, ChevronRight, Clock3, Play, Tv } from 'lucide-react';
import { LIST_STATUSES } from '../../../utils/listStatus';
import { statAura } from './statAura';

function compact(value) {
    if (value >= 10000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
    return Math.round(value).toLocaleString();
}

/**
 * One figure with its aura: the number takes the colour of its tier and
 * breathes a glow in it (wider and faster as the tier climbs; a sheen
 * sweeps the digits from purple up). The icon stays in the profile's own
 * colour. Tier 0 is plain.
 */
function AuraStat({ label, value, display, metric, icon: Icon }) {
    const aura = statAura(metric, value);
    return (
        <div
            className="flex min-w-0 items-center gap-3"
            title={aura.tier ? `${aura.name} aura` : undefined}
        >
            <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] sm:h-10 sm:w-10"
                style={{ backgroundColor: 'color-mix(in srgb, var(--pa) 16%, transparent)', color: 'var(--pa)' }}
            >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
                <dt className="sr-only">{label}</dt>
                <dd
                    className="profile-stat-value tabular"
                    data-aura={aura.tier || undefined}
                    style={aura.color ? { '--aura': aura.color } : undefined}
                >
                    {display}
                </dd>
                <dd aria-hidden="true" className="truncate text-[13px] text-[var(--text-3)]">{label}</dd>
            </div>
        </div>
    );
}

const DONUT_SIZE = 96;
const DONUT_STROKE = 13;

/**
 * The list by status as a flat ring: one arc per status in its fixed colour,
 * a small gap between arcs, the total in the middle.
 */
function StatusDonut({ statuses, total }) {
    const radius = (DONUT_SIZE - DONUT_STROKE) / 2;
    const circumference = 2 * Math.PI * radius;
    const gap = statuses.length > 1 ? 3 : 0;
    let offset = 0;
    return (
        <div className="relative shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
            <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="-rotate-90" aria-hidden="true">
                <circle
                    cx={DONUT_SIZE / 2}
                    cy={DONUT_SIZE / 2}
                    r={radius}
                    fill="none"
                    stroke="var(--ink-3)"
                    strokeWidth={DONUT_STROKE}
                />
                {statuses.map((status) => {
                    const length = (status.count / total) * circumference;
                    const arc = (
                        <circle
                            key={status.value}
                            cx={DONUT_SIZE / 2}
                            cy={DONUT_SIZE / 2}
                            r={radius}
                            fill="none"
                            stroke={status.color}
                            strokeWidth={DONUT_STROKE}
                            strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
                            strokeDashoffset={-offset}
                        />
                    );
                    offset += length;
                    return arc;
                })}
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-base font-semibold leading-none text-[var(--text-1)] tabular">{compact(total)}</span>
                <span className="mt-1 text-[11px] text-[var(--text-3)]">on list</span>
            </span>
        </div>
    );
}

/**
 * The numbers: four running totals, each with an aura whose colour climbs
 * with the number (green, blue, purple, gold, ruby), and the list by status
 * as a ring with a legend that opens each part.
 */
export default function StatsStrip({ user, summary, onOpenStatus, onOpenStats }) {
    const total = Number(summary?.total ?? user?.anime_count) || 0;
    const episodes = Number(summary?.episodes_watched ?? user?.episodes_watched) || 0;
    const minutes = Number(summary?.minutes) || 0;
    const days = minutes ? minutes / 1440 : Number(user?.days_watched) || 0;
    const counts = summary?.counts || {};
    const completed = Number(counts.Completed) || 0;

    const stats = [
        { metric: 'anime', label: 'Anime', value: total, display: compact(total), icon: Tv },
        { metric: 'episodes', label: 'Episodes', value: episodes, display: compact(episodes), icon: Play },
        {
            metric: 'days',
            label: 'Days watched',
            value: days,
            display: days >= 100 ? Math.round(days).toLocaleString() : days.toFixed(1),
            icon: Clock3,
        },
        { metric: 'completed', label: 'Completed', value: completed, display: compact(completed), icon: CheckCheck },
    ];

    const statuses = LIST_STATUSES
        .map((status) => ({ ...status, count: Number(counts[status.value]) || 0 }))
        .filter((status) => status.count > 0);
    const statusTotal = statuses.reduce((sum, status) => sum + status.count, 0);

    return (
        <section aria-labelledby="profile-stats-title" className="profile-card">
            <div className="mb-4 flex items-center justify-between gap-4">
                <h2 id="profile-stats-title" className="profile-card-title">Stats</h2>
                {onOpenStats && (
                    <button
                        type="button"
                        onClick={onOpenStats}
                        className="-my-2 inline-flex min-h-[2.75rem] items-center gap-0.5 text-sm font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                    >
                        See all
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                )}
            </div>

            <div className="grid items-center gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 md:gap-x-10 md:gap-y-5">
                    {stats.map((stat) => <AuraStat key={stat.metric} {...stat} />)}
                </dl>

                {statusTotal > 0 && (
                    <div className="flex items-center gap-5 border-t border-[var(--line-1)] pt-5 md:grid md:grid-cols-[1fr_auto] md:justify-items-center md:gap-8 md:border-t-0 md:pt-0">
                        <StatusDonut statuses={statuses} total={statusTotal} />
                        <ul className="grid min-w-0 flex-1 grid-cols-1 gap-y-0.5 md:w-48 md:flex-none md:justify-self-end">
                            {statuses.map((status) => (
                                <li key={status.value}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenStatus?.(status.value)}
                                        className="-mx-1.5 flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 text-sm text-[var(--text-2)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text-1)]"
                                    >
                                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: status.color }} />
                                        <span className="flex-1 pr-4 text-left">{status.label}</span>
                                        <span className="w-[3ch] text-right text-[var(--text-1)] tabular">{status.count.toLocaleString()}</span>
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
