import { useId } from 'react';
import {
    Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { format, isValid, parseISO } from 'date-fns';

import { formatNumber } from '../format';

/*
 * Charts in the site's palette: the periwinkle accent for a single series,
 * the fixed status colours for categories. No grid lines or axis rules (the
 * site has no lines); values come up in a slate tooltip.
 */

export const CHART_COLORS = ['#8db1ff', '#86cc90', '#b8a5ff', '#e9c46a', '#f391ba', '#7dd3c8', '#a3abb6'];

/** List status → its fixed site colour. */
export const STATUS_COLORS = {
    Watching: '#86cc90',
    Completed: '#b8a5ff',
    'On Hold': '#e9c46a',
    'On hold': '#e9c46a',
    Dropped: '#f391ba',
    'Plan to Watch': '#a3abb6',
    Planning: '#a3abb6',
};

const TICK = { fill: '#7d8591', fontSize: 12 };

const shortDate = (value) => {
    const date = typeof value === 'string' ? parseISO(value) : value;
    return isValid(date) ? format(date, 'd MMM') : String(value ?? '');
};

function ChartTooltip({ active, payload, label, labelFormat = shortDate, valueFormat = formatNumber, unit }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-[var(--radius-md)] bg-[var(--ink-3)] px-3 py-2 text-sm shadow-[var(--shadow-pop)]">
            <p className="text-xs text-[var(--text-3)]">{labelFormat(label) || payload[0]?.name}</p>
            {payload.map((entry) => (
                <p key={entry.dataKey ?? entry.name} className="mt-0.5 flex items-center gap-2 font-semibold tabular text-[var(--text-1)]">
                    {payload.length > 1 && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: entry.color || entry.payload?.fill }} />}
                    {valueFormat(entry.value)}{unit ? ` ${unit}` : ''}
                    {payload.length > 1 && <span className="font-normal text-[var(--text-2)]">{entry.name}</span>}
                </p>
            ))}
        </div>
    );
}

/**
 * A soft area trend over days. `data` rows have `x` (an ISO date by default)
 * and one key per series.
 *   <TrendChart data={rows} x="date" series={[{ key: 'count', name: 'Sign-ups' }]} />
 */
export function TrendChart({ data = [], x = 'date', series, height = 220, label, unit, xFormat = shortDate }) {
    const gradientBase = useId().replace(/:/g, '');
    const lines = series || [{ key: 'count', name: 'Count' }];
    return (
        <div role="img" aria-label={label} style={{ height }} className="-ml-2">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                        {lines.map((line, index) => {
                            const color = line.color || CHART_COLORS[index % CHART_COLORS.length];
                            return (
                                <linearGradient key={line.key} id={`${gradientBase}-${index}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                                </linearGradient>
                            );
                        })}
                    </defs>
                    <XAxis dataKey={x} tick={TICK} tickFormatter={xFormat} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} allowDecimals={false} tickFormatter={(value) => formatNumber(value)} />
                    <Tooltip cursor={{ stroke: 'rgb(255 255 255 / 0.12)' }} content={<ChartTooltip labelFormat={xFormat} unit={unit} />} />
                    {lines.map((line, index) => {
                        const color = line.color || CHART_COLORS[index % CHART_COLORS.length];
                        return (
                            <Area
                                key={line.key}
                                type="monotone"
                                dataKey={line.key}
                                name={line.name}
                                stroke={color}
                                strokeWidth={2}
                                fill={`url(#${gradientBase}-${index})`}
                                isAnimationActive={false}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0, fill: color }}
                            />
                        );
                    })}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Vertical bars for categories (ratings 1–10, statuses). `colors` maps a category to a colour. */
export function BarsChart({ data = [], x = 'label', y = 'value', height = 220, label, colors, unit }) {
    return (
        <div role="img" aria-label={label} style={{ height }} className="-ml-2">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey={x} tick={TICK} axisLine={false} tickLine={false} interval={0} />
                    <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} allowDecimals={false} tickFormatter={(value) => formatNumber(value)} />
                    <Tooltip cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} content={<ChartTooltip labelFormat={(value) => value} unit={unit} />} />
                    <Bar dataKey={y} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={36}>
                        {data.map((row, index) => (
                            <Cell key={row[x] ?? index} fill={colors?.[row[x]] || CHART_COLORS[0]} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

/**
 * A donut with its legend beside it (the legend carries the words and
 * numbers, so colour is never the only cue). Items: `{ label, value, color? }`.
 */
export function Donut({ items = [], label, height = 180 }) {
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const colored = items.map((item, index) => ({ ...item, color: item.color || STATUS_COLORS[item.label] || CHART_COLORS[index % CHART_COLORS.length] }));
    return (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div role="img" aria-label={label} style={{ height, width: height }} className="shrink-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                        <Pie data={colored} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" stroke="none" isAnimationActive={false} paddingAngle={colored.length > 1 ? 2 : 0}>
                            {colored.map((item) => <Cell key={item.label} fill={item.color} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip labelFormat={() => ''} />} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <ul className="w-full min-w-0 space-y-1.5">
                {colored.map((item) => (
                    <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-[var(--text-1)]">
                            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
                            <span className="truncate">{item.label}</span>
                        </span>
                        <span className="shrink-0 tabular text-[var(--text-2)]">
                            {formatNumber(item.value)}
                            {total > 0 && <span className="ml-1.5 text-xs text-[var(--text-3)]">{Math.round((Number(item.value) / total) * 100)}%</span>}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
