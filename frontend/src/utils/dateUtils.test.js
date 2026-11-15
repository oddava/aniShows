import { describe, expect, it } from 'vitest';

import {
    AUTO_TIMEZONE_VALUE,
    formatCalendarDate,
    getZonedCalendarToday,
    getWeekdayIndex,
    groupScheduleDaysByTimezone,
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

    it('regroups schedule items into the selected timezone day', () => {
        const item = {
            id: 1,
            title: 'Timezone Test Show',
            broadcast_day: 'Monday',
            next_airing_date: '2026-04-13T01:30:00Z',
        };

        const payload = {
            monday: [item],
            sunday: [],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
        };

        const losAngeles = groupScheduleDaysByTimezone(payload, 'America/Los_Angeles');
        const tokyo = groupScheduleDaysByTimezone(payload, 'Asia/Tokyo');

        expect(losAngeles.sunday).toHaveLength(1);
        expect(losAngeles.monday).toHaveLength(0);
        expect(tokyo.monday).toHaveLength(1);
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
