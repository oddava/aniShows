import { describe, it, expect } from 'vitest';

import { animeTypeLabel, describeSchedule } from '../format';
import { withCurrentSort } from '../ui';
import { fillDays } from '../pages/Dashboard';
import { describeHistoryEntry } from '../pages/people/history';
import { usersApiParams } from '../pages/Users';

describe('describeSchedule', () => {
    it.each([
        ['5 * * * *', 'Hourly at :05'],
        ['0 2 * * *', 'Daily at 02:00 UTC'],
        ['30 8,20 * * *', 'Twice daily at 08:30 and 20:30 UTC'],
        ['*/30 * * * *', 'Every 30 minutes'],
        ['15 */6 * * *', 'Every 6 hours at :15'],
        ['30 3 * * 0', 'Sundays at 03:30 UTC'],
        ['* * * * *', 'Every minute'],
        ['every 60s', 'Every minute'],
        ['every 7200s', 'Every 2 hours'],
        ['0 0 1 * *', '0 0 1 * *'],
    ])('%s → %s', (raw, words) => {
        expect(describeSchedule(raw)).toBe(words);
    });
});

describe('animeTypeLabel', () => {
    it('keeps acronyms upper case', () => {
        expect(animeTypeLabel('TV')).toBe('TV');
        expect(animeTypeLabel('tv')).toBe('TV');
        expect(animeTypeLabel('Movie')).toBe('Movie');
        expect(animeTypeLabel('')).toBe('');
    });
});

describe('withCurrentSort', () => {
    const options = [{ value: '-created_at', label: 'Recently added' }];
    it('adds a column ordering the menu does not list', () => {
        expect(withCurrentSort(options, 'rating')[0]).toEqual({ value: 'rating', label: 'Column order: rating' });
        expect(withCurrentSort(options, '-created_at')).toBe(options);
    });
});

describe('fillDays', () => {
    it('counts days in UTC like the server', () => {
        const now = Date.UTC(2026, 10, 26, 0, 30); // just after midnight UTC
        const rows = fillDays([{ date: '2026-11-26', count: 2 }, { date: '2026-11-25', count: 5 }], 2, 'count', now);
        expect(rows).toEqual([{ date: '2026-11-25', count: 5 }, { date: '2026-11-26', count: 2 }]);
    });
});

describe('describeHistoryEntry', () => {
    it('names support actions by their operation', () => {
        expect(describeHistoryEntry({ action: 'CONTROL', operation: 'revoke_sessions' })).toBe('Signed out everywhere');
        expect(describeHistoryEntry({ action: 'TRIGGER', operation: 'send_password_reset' })).toBe('Password reset email queued');
        expect(describeHistoryEntry({ action: 'UPDATE', operation: 'clear_profile', changes: { bio: { old: 'x', new: '' } } })).toBe('Bio cleared');
        expect(describeHistoryEntry({ action: 'SUSPEND' })).toBe('Suspended');
    });
});

describe('usersApiParams', () => {
    it('turns the role and joined presets into API filters', () => {
        const now = new Date(2026, 10, 26, 2, 47);
        expect(usersApiParams({ role: 'moderators', joined: '7', page: 1 }, now)).toEqual({
            page: 1, is_staff: 'true', is_superuser: 'false', joined_since: new Date(2026, 10, 20).toISOString(),
        });
        // "All staff" counts superusers too, as Analytics does.
        expect(usersApiParams({ role: 'staff' }, now)).toEqual({ is_staff: 'true' });
        // "Joined today" starts at local midnight, whatever UTC date that is.
        expect(usersApiParams({ joined: '1' }, now).joined_since).toBe(new Date(2026, 10, 26).toISOString());
    });
});
