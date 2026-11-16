import { describe, expect, it } from 'vitest';

import {
    AUTO_TIMEZONE_VALUE,
    formatCalendarDate,
    getZonedCalendarToday,
    bucketScheduleByDate,
    formatDate,
    getWeekdayIndex,
    hasAiringDate,
    normalizeTimeZonePreference,
} from './dateUtils';

describe('dateUtils', () => {
    it('normalizes blank or auto timezone preferences', () => {
        expect(normalizeTimeZonePreference('')).toBe(AUTO_TIMEZONE_VALUE);
        expect(normalizeTimeZonePreference('auto')).toBe(AUTO_TIMEZONE_VALUE);
        expect(normalizeTimeZonePreference('AUTO')).toBe(AUTO_TIMEZONE_VALUE);
    });

    it('rejects invalid timezone preferences', () => {
        expect(normalizeTimeZonePreference('Mars/Olympus')).toBe(AUTO_TIMEZONE_VALUE);
    });

    it('computes weekday index in the requested timezone', () => {
        const timestamp = '2026-04-13T01:30:00Z';

        expect(getWeekdayIndex(timestamp, 'America/Los_Angeles')).toBe(0);
        expect(getWeekdayIndex(timestamp, 'Asia/Tokyo')).toBe(1);
    });

    it('buckets a show by its calendar date in the selected timezone', () => {
        // 01:30 UTC Monday is still Sunday evening in Los Angeles.
        const now = new Date('2026-04-12T20:00:00Z');
        const item = { id: 1, title: 'Timezone Test Show', next_airing_date: '2026-04-13T01:30:00Z' };

        const losAngeles = bucketScheduleByDate({ monday: [item] }, 'America/Los_Angeles', now);
        const tokyo = bucketScheduleByDate({ monday: [item] }, 'Asia/Tokyo', now);

        expect(losAngeles.days[0]).toHaveLength(1); // Sunday the 12th, today in LA
        expect(tokyo.days[0]).toHaveLength(1); // Monday the 13th, today in Tokyo
    });
});

describe('getZonedCalendarToday', () => {
    // 2026-11-16 16:00 UTC: already Monday the 16th in Tashkent (UTC+5),
    // still Monday the 16th 08:00 in Los Angeles; 2026-11-16 03:00 UTC is
    // Sunday the 15th in Los Angeles but Monday the 16th in Tashkent.
    it('returns the calendar date in the preferred zone, not the browser zone', () => {
        const late = new Date(Date.UTC(2026, 10, 16, 3, 0));
        const la = getZonedCalendarToday('America/Los_Angeles', late);
        const tashkent = getZonedCalendarToday('Asia/Tashkent', late);
        expect(formatCalendarDate(la, { weekday: 'long', month: 'short', day: 'numeric' })).toBe('Sunday, Nov 15');
        expect(formatCalendarDate(tashkent, { weekday: 'long', month: 'short', day: 'numeric' })).toBe('Monday, Nov 16');
        expect(la.getUTCDay()).toBe(0);
        expect(tashkent.getUTCDay()).toBe(1);
    });
});

describe('bucketScheduleByDate', () => {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    // Monday 2026-11-16 12:00 UTC.
    const monday = new Date(Date.UTC(2026, 10, 16, 12, 0));
    const show = (id, nextAiringDate, extra = {}) => ({
        id,
        title: `Show ${id}`,
        next_airing_date: nextAiringDate ? new Date(nextAiringDate).toISOString() : null,
        ...extra,
    });
    const offsetOf = (days, id) => days.findIndex((items) => items.some((item) => item.id === id));

    it.each([
        ['UTC', 'UTC'],
        ['UTC+14', 'Pacific/Kiritimati'],
        ['UTC-12', 'Etc/GMT+12'],
    ])('puts a show 2 days out under the date 2 days out (%s)', (_label, zone) => {
        const item = show(1, monday.getTime() + 2 * DAY);
        const { days, laterCount } = bucketScheduleByDate({ wednesday: [item] }, zone, monday);

        expect(offsetOf(days, 1)).toBe(2);
        expect(laterCount).toBe(0);
        // The column's date is today + 2 in that zone, the same date the show airs on.
        const columnDate = new Date(getZonedCalendarToday(zone, monday).getTime() + 2 * DAY);
        expect(formatCalendarDate(columnDate, { month: 'short', day: 'numeric' })).toBe(
            formatDate(item.next_airing_date, { month: 'short', day: 'numeric' }, zone)
        );
    });

    it('keeps date offsets across Saturday to Sunday', () => {
        const saturday = new Date(Date.UTC(2026, 10, 21, 12, 0));
        const sunday = show(1, saturday.getTime() + DAY);
        const monday2 = show(2, saturday.getTime() + 2 * DAY);
        const { days } = bucketScheduleByDate({ sunday: [sunday], monday: [monday2] }, 'UTC', saturday);

        expect(offsetOf(days, 1)).toBe(1);
        expect(offsetOf(days, 2)).toBe(2);
    });

    it('leaves out a show 10 days out and counts it as airing later', () => {
        const { days, laterCount } = bucketScheduleByDate(
            { monday: [show(1, monday.getTime() + 10 * DAY)] },
            'UTC',
            monday
        );

        expect(days.flat()).toHaveLength(0);
        expect(laterCount).toBe(1);
    });

    it('drops stale dates before today but keeps one that aired earlier today', () => {
        const { days, laterCount } = bucketScheduleByDate(
            { saturday: [show(1, monday.getTime() - 2 * DAY)], monday: [show(2, monday.getTime() - 3 * HOUR)] },
            'UTC',
            monday
        );

        expect(offsetOf(days, 1)).toBe(-1);
        expect(offsetOf(days, 2)).toBe(0);
        expect(laterCount).toBe(0);
    });

    it('puts a show with only a broadcast day under that weekday (time TBA)', () => {
        const item = show(1, null, { broadcast_day: 'Wednesday' });
        const { days } = bucketScheduleByDate({ wednesday: [item] }, 'UTC', monday);

        expect(offsetOf(days, 1)).toBe(2);
        expect(hasAiringDate(item)).toBe(false);
    });
});
