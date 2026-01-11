/**
 * Date utility functions for airing schedule display
 */

/**
 * Format a date as a relative time string (e.g., "in 2 days", "Tomorrow", "in 5h")
 * @param {string|Date} date - The target date
 * @returns {string} Relative time string
 */
export function formatRelativeTime(date) {
    const now = new Date();
    const target = new Date(date);
    const diffMs = target - now;

    if (diffMs < 0) return 'Aired';

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (minutes < 60) return 'Soon';
    if (hours < 24) return `in ${hours}h`;
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `in ${days} days`;

    return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a date as a full airing time string
 * @param {string|Date} date - The target date
 * @returns {string} Formatted date string (e.g., "Sat, Jan 18, 3:00 PM")
 */
export function formatAiringTime(date) {
    const target = new Date(date);
    return target.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Check if a date is within the next 24 hours
 * @param {string|Date} date - The target date
 * @returns {boolean} True if within 24 hours
 */
export function isWithin24Hours(date) {
    const now = new Date();
    const target = new Date(date);
    const diffMs = target - now;
    const hours = diffMs / (1000 * 60 * 60);
    return hours > 0 && hours <= 24;
}
