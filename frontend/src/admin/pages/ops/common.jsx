import { Chip } from '../../ui';
import { humanize } from '../../format';

export { useOpenParam } from '../../hooks';

/** A JSON (or text) payload in a code block; nothing when it is empty. */
export function CodeBlock({ value, label, empty = null }) {
    const isEmpty = value === null || value === undefined || value === ''
        || (typeof value === 'object' && Object.keys(value).length === 0);
    if (isEmpty) return empty;
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return (
        <div>
            {label && <p className="mb-1.5 text-xs font-medium text-[var(--text-3)]">{label}</p>}
            <pre className="admin-code">{text}</pre>
        </div>
    );
}

/** A titled block inside a drawer (no panel: drawers are already a surface). */
export function DrawerSection({ title, children, action }) {
    return (
        <section className="mt-6 first:mt-0">
            <div className="mb-2.5 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text-1)]">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

const CELERY_TONES = {
    SUCCESS: 'success',
    FAILURE: 'danger',
    STARTED: 'accent',
    RETRY: 'warning',
    PENDING: 'neutral',
    REVOKED: 'neutral',
};

const CELERY_LABELS = {
    SUCCESS: 'Succeeded',
    FAILURE: 'Failed',
    STARTED: 'Running',
    RETRY: 'Retrying',
    PENDING: 'Waiting',
    REVOKED: 'Cancelled',
};

export function CeleryStatusChip({ status }) {
    return <Chip tone={CELERY_TONES[status] || 'neutral'} dot>{CELERY_LABELS[status] || humanize(status)}</Chip>;
}

/** Job statuses shared by catalog imports and list imports (lower-case values). */
const JOB_TONES = {
    pending: 'neutral',
    processing: 'accent',
    completed: 'success',
    failed: 'danger',
    cancelled: 'neutral',
};

const JOB_LABELS = {
    pending: 'Waiting',
    processing: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
};

export function JobStatusChip({ status }) {
    return <Chip tone={JOB_TONES[status] || 'neutral'} dot>{JOB_LABELS[status] || humanize(status)}</Chip>;
}

export const JOB_STATUS_TABS = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Waiting' },
    { value: 'processing', label: 'Running' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
];

/** Seconds between two ISO times, or null. */
export function secondsBetween(start, end) {
    if (!start || !end) return null;
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

/** Save a JSON value as a file. */
export function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}
