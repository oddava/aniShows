import { humanize } from '../../format';
import { Chip } from '../../ui';

export const ANIME_STATUSES = ['Airing', 'Finished', 'Upcoming', 'Unknown'];
export const ANIME_TYPES = ['TV', 'Movie', 'OVA', 'ONA', 'Special', 'Unknown'];
export const SEASONS = [
    { value: 'WINTER', label: 'Winter' },
    { value: 'SPRING', label: 'Spring' },
    { value: 'SUMMER', label: 'Summer' },
    { value: 'FALL', label: 'Fall' },
];

const STATUS_TONES = { Airing: 'success', Finished: 'violet', Upcoming: 'accent', Unknown: 'neutral' };

export function AnimeStatusChip({ status }) {
    if (!status) return null;
    return <Chip tone={STATUS_TONES[status] || 'neutral'} dot>{humanize(status)}</Chip>;
}

/** TV and OVA stay upper case; everything else is sentence case. */
export const typeLabel = (type) => (['TV', 'OVA', 'ONA'].includes(type) ? type : humanize(type, ''));

export const SYNC_STATUSES = [
    'pending', 'in_progress', 'synced', 'transient_error', 'blocked_identity', 'blocked_no_ids', 'quarantined',
];

const SYNC_TONES = {
    synced: 'success',
    pending: 'neutral',
    in_progress: 'accent',
    transient_error: 'warning',
    blocked_identity: 'danger',
    blocked_no_ids: 'danger',
    quarantined: 'danger',
};

/** A sync stage status as a soft chip with its word. */
export function SyncStatusChip({ value }) {
    if (!value) return <span className="text-[var(--text-3)]">—</span>;
    return <Chip tone={SYNC_TONES[value] || 'neutral'} dot>{humanize(value)}</Chip>;
}
