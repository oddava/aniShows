import { describe, expect, it } from 'vitest';

import {
    AUTO_TIMEZONE_VALUE,
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
