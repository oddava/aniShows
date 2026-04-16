const AUTO_TIMEZONE_VALUE = 'auto';
const TIMEZONE_STORAGE_KEY = 'aniShows.userTimezonePreference';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_INDEX_BY_NAME = Object.fromEntries(DAY_NAMES.map((day, index) => [day, index]));
const FALLBACK_TIMEZONES = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Shanghai',
    'Australia/Sydney',
];

function getSafeLocalStorage() {
    if (typeof window === 'undefined') return null;

    try {
        const storage = window.localStorage;
        if (
            storage &&
            typeof storage.getItem === 'function' &&
            typeof storage.setItem === 'function' &&
            typeof storage.removeItem === 'function'
        ) {
            return storage;
        }
    } catch {
        // Fall through to null.
    }

    return null;
}

function parseDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function getBrowserTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

export function isValidTimeZone(value) {
    if (!value || value === AUTO_TIMEZONE_VALUE) return true;

    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export function normalizeTimeZonePreference(value) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.toLowerCase() === AUTO_TIMEZONE_VALUE) {
        return AUTO_TIMEZONE_VALUE;
    }

    return isValidTimeZone(normalized) ? normalized : AUTO_TIMEZONE_VALUE;
}

export function getStoredTimeZonePreference() {
    const storage = getSafeLocalStorage();
    if (!storage) return AUTO_TIMEZONE_VALUE;
    return normalizeTimeZonePreference(storage.getItem(TIMEZONE_STORAGE_KEY));
}

export function syncStoredTimeZonePreference(value) {
    const storage = getSafeLocalStorage();
    if (!storage) return;

    const normalized = normalizeTimeZonePreference(value);
    if (normalized === AUTO_TIMEZONE_VALUE) {
        storage.setItem(TIMEZONE_STORAGE_KEY, AUTO_TIMEZONE_VALUE);
        return;
    }

    storage.setItem(TIMEZONE_STORAGE_KEY, normalized);
}

export function clearStoredTimeZonePreference() {
    const storage = getSafeLocalStorage();
    if (!storage) return;
    storage.removeItem(TIMEZONE_STORAGE_KEY);
}

export function resolveTimeZone(preference) {
    const normalized = normalizeTimeZonePreference(
        preference == null ? getStoredTimeZonePreference() : preference
    );
    return normalized === AUTO_TIMEZONE_VALUE ? getBrowserTimeZone() : normalized;
}

export function getSupportedTimeZones() {
    if (typeof Intl.supportedValuesOf === 'function') {
        try {
            const zones = Intl.supportedValuesOf('timeZone');
            if (Array.isArray(zones) && zones.length > 0) {
                return zones;
            }
        } catch {
            // Fall through to the curated fallback list.
        }
    }

    return FALLBACK_TIMEZONES;
}

export function formatTimeZoneLabel(value) {
    return String(value || '')
        .split('/')
        .map((segment) => segment.replace(/_/g, ' '))
        .join(' / ');
}

export function formatDateTime(value, options = {}, preference) {
    const date = parseDate(value);
    if (!date) return '';

    return new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTimeZone(preference),
        ...options,
    }).format(date);
}

export function formatDate(value, options = {}, preference) {
    const date = parseDate(value);
    if (!date) return '';

    return new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTimeZone(preference),
        ...options,
    }).format(date);
}

export function getWeekdayIndex(value, preference) {
    const date = parseDate(value);
    if (!date) return 0;

    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: resolveTimeZone(preference),
    }).format(date);

    return DAY_INDEX_BY_NAME[weekday] ?? 0;
}

export function getCurrentWeekdayIndex(preference) {
    return getWeekdayIndex(new Date(), preference);
}

function compareScheduleItems(a, b) {
    const dateA = parseDate(a?.next_airing_date);
    const dateB = parseDate(b?.next_airing_date);

    if (dateA && dateB) return dateA - dateB;
    if (dateA) return -1;
    if (dateB) return 1;

    if (a?.broadcast_time && b?.broadcast_time) {
        return String(a.broadcast_time).localeCompare(String(b.broadcast_time));
    }

    return String(a?.title || '').localeCompare(String(b?.title || ''));
}

export function groupScheduleDaysByTimezone(daysPayload = {}, preference) {
    const groupedDays = Object.fromEntries(
        DAY_NAMES.map((day) => [day.toLowerCase(), []])
    );
    const payloadEntries = Object.entries(daysPayload || {}).filter(([, items]) => Array.isArray(items));

    payloadEntries.forEach(([sourceKey, items]) => {
        items.forEach((item) => {
        const nextAiringDate = parseDate(item?.next_airing_date);
        const broadcastDay = String(item?.broadcast_day || '').trim().toLowerCase();
        let targetKey = '';

        if (nextAiringDate) {
            targetKey = DAY_NAMES[getWeekdayIndex(nextAiringDate, preference)].toLowerCase();
        } else if (Object.prototype.hasOwnProperty.call(DAY_INDEX_BY_NAME, String(item?.broadcast_day || '').trim())) {
            targetKey = String(item.broadcast_day).trim().toLowerCase();
        } else if (broadcastDay in groupedDays) {
            targetKey = broadcastDay;
        } else if (sourceKey in groupedDays) {
            targetKey = sourceKey;
        }

        if (!targetKey || !(targetKey in groupedDays)) return;
        groupedDays[targetKey].push(item);
        });
    });

    Object.keys(groupedDays).forEach((key) => {
        groupedDays[key].sort(compareScheduleItems);
    });

    return groupedDays;
}

/**
 * Format a date as a relative time string (e.g., "in 2 days", "Tomorrow", "in 5h")
 * Relative countdowns are timezone-agnostic because they compare absolute timestamps.
 */
export function formatRelativeTime(date, preference) {
    const now = new Date();
    const target = parseDate(date);
    if (!target) return 'Unknown';

    const diffMs = target - now;

    if (diffMs < 0) return 'Aired';

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (minutes < 60) return 'Soon';
    if (hours < 24) return `in ${hours}h`;
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `in ${days} days`;

    return formatDate(target, { month: 'short', day: 'numeric' }, preference);
}

/**
 * Format a date as a full airing time string in the selected timezone.
 */
export function formatAiringTime(date, preference) {
    return formatDateTime(
        date,
        {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
        },
        preference
    );
}

export function formatDateTimeInUserTimezone(value, options = {}) {
    return formatDateTime(value, options);
}

export function formatDateInUserTimezone(value, options = {}) {
    return formatDate(value, options);
}

/**
 * Check if a date is within the next 24 hours.
 */
export function isWithin24Hours(date) {
    const now = new Date();
    const target = parseDate(date);
    if (!target) return false;

    const diffMs = target - now;
    const hours = diffMs / (1000 * 60 * 60);
    return hours > 0 && hours <= 24;
}

export { AUTO_TIMEZONE_VALUE, DAY_NAMES };
