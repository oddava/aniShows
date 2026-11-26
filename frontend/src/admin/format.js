import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

const toDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : parseISO(String(value));
    return isValid(date) ? date : null;
};

/** 26 Nov 2026 */
export function formatDate(value, fallback = '—') {
    const date = toDate(value);
    return date ? format(date, 'd MMM yyyy') : fallback;
}

/** 26 Nov 2026, 14:05 */
export function formatDateTime(value, fallback = '—') {
    const date = toDate(value);
    return date ? format(date, 'd MMM yyyy, HH:mm') : fallback;
}

/** 3 hours ago (or "just now"). */
export function formatRelative(value, fallback = '—') {
    const date = toDate(value);
    if (!date) return fallback;
    if (Math.abs(Date.now() - date.getTime()) < 45_000) return 'just now';
    return formatDistanceToNowStrict(date, { addSuffix: true });
}

const numberFormat = new Intl.NumberFormat('en');
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 12,480 */
export function formatNumber(value, fallback = '—') {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback;
    return numberFormat.format(Number(value));
}

/** 12.5K */
export function formatCompact(value, fallback = '—') {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback;
    return Number(value) < 10_000 ? numberFormat.format(Number(value)) : compactFormat.format(Number(value));
}

/** 1.4 GB */
export function formatBytes(bytes, fallback = '—') {
    if (bytes === null || bytes === undefined) return fallback;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes);
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 1.2 s, 340 ms */
export function formatDuration(ms, fallback = '—') {
    if (ms === null || ms === undefined) return fallback;
    const value = Number(ms);
    if (value < 1000) return `${Math.round(value)} ms`;
    if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    return `${minutes} min ${seconds} s`;
}

/** +12% / −3% from a percentage number. */
export function formatChange(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
    const rounded = Math.round(Number(value) * 10) / 10;
    if (rounded === 0) return '0%';
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

/** "1 review" / "3 reviews" */
export function plural(count, one, many = `${one}s`) {
    return `${formatNumber(count)} ${Number(count) === 1 ? one : many}`;
}

/** snake_case / SCREAMING → "Sentence case". */
export function humanize(value, fallback = '—') {
    if (value === null || value === undefined || value === '') return fallback;
    const text = String(value).replace(/[_-]+/g, ' ').trim().toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The last dotted segment of a task path: apps.animes.tasks.catalog.run_catalog_lane → run_catalog_lane. */
export function shortTaskName(name = '') {
    return String(name).split('.').pop() || name;
}

/** Anime format for display: acronyms stay upper case ("TV", "OVA"), the rest sentence case. */
export function animeTypeLabel(type, fallback = '') {
    const value = String(type ?? '').trim();
    if (!value) return fallback;
    return ['TV', 'OVA', 'ONA', 'TV_SHORT'].includes(value.toUpperCase()) && value.length <= 8
        ? value.toUpperCase().replace('_SHORT', ' short')
        : humanize(value, fallback);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (value) => String(value).padStart(2, '0');
const isNumber = (value) => /^\d+$/.test(value);

/**
 * A beat schedule in plain words: "5 * * * *" → "Hourly at :05",
 * "0 2 * * *" → "Daily at 02:00 UTC", "every 60s" → "Every minute".
 * Anything unusual comes back as given (callers show the raw text as a tooltip).
 */
export function describeSchedule(text) {
    const raw = String(text ?? '').trim();
    const every = raw.match(/^every (\d+)s$/);
    if (every) {
        const seconds = Number(every[1]);
        if (seconds % 3600 === 0) return seconds === 3600 ? 'Every hour' : `Every ${seconds / 3600} hours`;
        if (seconds % 60 === 0) return seconds === 60 ? 'Every minute' : `Every ${seconds / 60} minutes`;
        return `Every ${seconds} seconds`;
    }
    const parts = raw.split(/\s+/);
    if (parts.length !== 5) return raw;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    if (dayOfMonth !== '*' || month !== '*') return raw;
    if (minute === '*' && hour === '*' && dayOfWeek === '*') return 'Every minute';
    const minuteStep = minute.match(/^\*\/(\d+)$/);
    if (minuteStep && hour === '*' && dayOfWeek === '*') return `Every ${minuteStep[1]} minutes`;
    if (!isNumber(minute)) return raw;
    if (hour === '*' && dayOfWeek === '*') return `Hourly at :${pad(minute)}`;
    const hourStep = hour.match(/^\*\/(\d+)$/);
    if (hourStep && dayOfWeek === '*') return `Every ${hourStep[1]} hours at :${pad(minute)}`;
    const hours = hour.split(',');
    if (!hours.every(isNumber)) return raw;
    const times = hours.map((value) => `${pad(value)}:${pad(minute)}`).join(' and ');
    if (dayOfWeek === '*') return `${hours.length === 2 ? 'Twice daily' : 'Daily'} at ${times} UTC`;
    if (isNumber(dayOfWeek) && Number(dayOfWeek) <= 6) return `${WEEKDAYS[Number(dayOfWeek)]}s at ${times} UTC`;
    return raw;
}
