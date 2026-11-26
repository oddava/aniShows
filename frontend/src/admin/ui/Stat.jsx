import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

import Skeleton from '../../components/ui/Skeleton';
import { formatChange, formatCompact, formatNumber } from '../format';

/**
 * A KPI tile: label, big number, one line of context. `change` is a percent
 * (positive is shown in green unless `invertChange`). With `to` the tile is a
 * link to the list behind the number.
 */
export function StatCard({ label, value, hint, change, invertChange = false, to: target, loading = false, tone, compact = false }) {
    // A zero leads to an empty list: no link, no arrow.
    const to = value === 0 ? null : target;
    const changeText = formatChange(change);
    const positive = Number(change) > 0;
    const good = invertChange ? !positive : positive;
    const valueTone = {
        danger: 'text-[var(--danger)]',
        warning: 'text-[var(--status-on-hold)]',
        accent: 'text-[var(--signature)]',
    }[tone] || 'text-[var(--text-1)]';

    const body = (
        <>
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-[var(--text-2)]">{label}</p>
                {to && <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--text-3)] transition-colors group-hover:text-[var(--text-1)]" aria-hidden="true" />}
            </div>
            {loading ? (
                <Skeleton className="mt-3 h-8 w-24" />
            ) : (
                <p className={`mt-2 font-semibold leading-none tracking-[-0.02em] tabular ${compact ? 'text-2xl' : 'text-[1.75rem] sm:text-[2rem]'} ${valueTone}`}>
                    {typeof value === 'number' ? formatNumber(value) : value ?? '—'}
                </p>
            )}
            {(hint || changeText) && !loading && (
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-3)]">
                    {changeText && changeText !== '0%' && (
                        <span className={`font-semibold tabular ${good ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{changeText}</span>
                    )}
                    {hint && <span>{hint}</span>}
                </p>
            )}
        </>
    );

    const classes = 'group block rounded-[var(--radius-lg)] bg-[var(--ink-1)] p-4 sm:p-5';
    if (to) {
        return <Link to={to} className={`${classes} transition-colors hover:bg-[var(--ink-2)]`}>{body}</Link>;
    }
    return <div className={classes}>{body}</div>;
}

/** A grid of StatCards: 2 across on phones, up to `columns` on desktop. */
export function StatGrid({ children, columns = 4, className = '' }) {
    const cols = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[columns] || 'lg:grid-cols-4';
    return <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${cols} ${className}`}>{children}</div>;
}

/**
 * Ranked rows with a proportional soft bar behind each: top genres, busiest
 * users. Items: `{ key, label, value, to?, meta? }`.
 */
export function BarList({ items, valueFormat = formatCompact, empty = 'No data yet.', color = 'var(--signature-soft)' }) {
    if (!items?.length) return <p className="py-4 text-sm text-[var(--text-3)]">{empty}</p>;
    const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
    return (
        <ul className="space-y-1">
            {items.map((item) => {
                const width = `${Math.max(2, ((Number(item.value) || 0) / max) * 100)}%`;
                const label = item.to
                    ? <Link to={item.to} className="truncate hover:text-[var(--signature)]">{item.label}</Link>
                    : <span className="truncate">{item.label}</span>;
                return (
                    <li key={item.key ?? item.label} className="relative flex min-h-9 items-center justify-between gap-3 overflow-hidden rounded-md px-2.5 text-sm">
                        <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-md" style={{ width, background: color }} />
                        <span className="relative flex min-w-0 items-center gap-2 text-[var(--text-1)]">
                            {label}
                            {item.meta && <span className="shrink-0 text-xs text-[var(--text-3)]">{item.meta}</span>}
                        </span>
                        <span className="relative shrink-0 font-medium tabular text-[var(--text-2)]">{valueFormat(item.value)}</span>
                    </li>
                );
            })}
        </ul>
    );
}

/** A thin progress meter with its numbers: "Budget 42 of 90". */
export function Meter({ value, max, label, tone = 'accent', showValue = true }) {
    const percent = max ? Math.min(100, Math.max(0, (Number(value) / Number(max)) * 100)) : 0;
    const fills = {
        accent: 'bg-[var(--signature)]',
        success: 'bg-[var(--success)]',
        warning: 'bg-[var(--status-on-hold)]',
        danger: 'bg-[var(--danger)]',
    };
    return (
        <div>
            {(label || showValue) && (
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    {label && <span className="text-[var(--text-2)]">{label}</span>}
                    {showValue && <span className="tabular text-[var(--text-1)]">{formatNumber(value)}<span className="text-[var(--text-3)]"> / {formatNumber(max)}</span></span>}
                </div>
            )}
            <div
                role="meter"
                aria-valuenow={Number(value) || 0}
                aria-valuemin={0}
                aria-valuemax={Number(max) || 0}
                aria-label={typeof label === 'string' ? label : undefined}
                className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"
            >
                <div className={`h-full rounded-full ${fills[tone] || fills.accent}`} style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
}
