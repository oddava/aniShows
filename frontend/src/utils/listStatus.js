import { Bookmark, Check, Eye, Pause, X } from 'lucide-react';

/*
 * The five list statuses: one label each (T7) and one fixed colour each
 * (V1). `value` is what the API stores; `label` is what people read,
 * everywhere: menus, tabs, filters, stats, toasts.
 */
export const LIST_STATUSES = [
    { value: 'Watching', label: 'Watching', color: 'var(--status-watching)', icon: Eye },
    { value: 'Completed', label: 'Completed', color: 'var(--status-completed)', icon: Check },
    { value: 'Plan to Watch', label: 'Planning', color: 'var(--status-planning)', icon: Bookmark },
    { value: 'On Hold', label: 'On hold', color: 'var(--status-on-hold)', icon: Pause },
    { value: 'Dropped', label: 'Dropped', color: 'var(--status-dropped)', icon: X },
];

const BY_VALUE = Object.fromEntries(LIST_STATUSES.map((status) => [status.value, status]));

/** Older payloads and URLs use these spellings for the same statuses. */
const ALIASES = {
    planning: 'Plan to Watch',
    plan_to_watch: 'Plan to Watch',
    'plan to watch': 'Plan to Watch',
    on_hold: 'On Hold',
    'on hold': 'On Hold',
    watching: 'Watching',
    completed: 'Completed',
    dropped: 'Dropped',
};

export function normalizeStatus(value) {
    if (!value) return null;
    if (BY_VALUE[value]) return value;
    return ALIASES[String(value).trim().toLowerCase()] || null;
}

export function statusMeta(value) {
    return BY_VALUE[normalizeStatus(value)] || null;
}

export function statusLabel(value) {
    return statusMeta(value)?.label || value || '';
}

/** "Added to Watching" / "Moved to Completed": the toast after a status write. */
export function statusChangeMessage(previousStatus, nextStatus) {
    const label = statusLabel(nextStatus);
    return previousStatus ? `Moved to ${label}` : `Added to ${label}`;
}
