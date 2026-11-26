import { formatDateInUserTimezone } from '../../utils/dateUtils';

/**
 * Watching entries the profile reads in two places (the hero's "watching now"
 * card and the overview shelf). Same query key and the same page size, so
 * both share one request.
 */
export const WATCHING_SHELF = 12;

/** Rows from a list/favorites payload: a page array, DRF pages or a flat array. */
export function resultsOf(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.pages)) {
        return data.pages.flatMap((page) => (Array.isArray(page) ? page : page?.results || []));
    }
    return data?.results || [];
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDateInUserTimezone(date, { month: 'short', day: 'numeric' });
}
