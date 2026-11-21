import { useEffect, useState } from 'react';
import { bucketScheduleByDate, formatDate, getZonedCalendarToday, SCHEDULE_DAYS } from '../../utils/dateUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Re-render once a minute so countdowns and "out" marks stay true without a refetch. */
export function useMinuteClock() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

/** Statuses whose shows count as "on your list" for airing times. */
export const LISTED = new Set(['Watching', 'Plan to Watch', 'On Hold']);

/** "17:43" in the viewer's zone. */
export const clockTime = (at, timezone) => formatDate(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, timezone);

/** Calendar days from today to `at`, both read in the viewer's zone. */
export function dayOffset(at, timezone, now = Date.now()) {
    const today = getZonedCalendarToday(timezone, new Date(now));
    return Math.round((getZonedCalendarToday(timezone, new Date(at)) - today) / DAY_MS);
}

/**
 * Every timed airing of a show on your list: Watching entries plus the listed
 * shows in this week's schedule, once per show. `at` is the API's
 * next_airing_date, which may already be past (aired, not yet synced on).
 */
export function listedAirings(watching, scheduleDays) {
    const seen = new Set();
    const rows = [];
    const add = (anime) => {
        const at = Date.parse(anime?.next_airing_date);
        if (!anime?.id || seen.has(anime.id) || !Number.isFinite(at)) return;
        seen.add(anime.id);
        rows.push({ anime, at, episode: Number(anime.next_airing_episode) || null });
    };
    (watching || []).forEach((entry) => add(entry.anime));
    Object.values(scheduleDays || {}).forEach((items) => {
        if (!Array.isArray(items)) return;
        items.filter((anime) => LISTED.has(anime.user_list_status?.status)).forEach(add);
    });
    return rows.sort((a, b) => a.at - b.at);
}

/**
 * Tonight: today's episodes from your list in time order, the ones that
 * already aired today included (`aired`). With none today, `next` is the
 * next one within a week.
 */
export function tonightFrom(airings, now = Date.now(), timezone) {
    const today = airings
        .filter((row) => dayOffset(row.at, timezone, now) === 0)
        .map((row) => ({ ...row, aired: row.at <= now }));
    // The next episode still to come (today or within a week).
    const next = airings.find((row) => row.at > now && row.at - now < 7 * DAY_MS) || null;
    return { today, next };
}

/**
 * Your week as an agenda: only the days with a listed show, today first.
 * Past airings today stay, marked `aired`.
 */
export function weekAgenda(scheduleDays, timezone, now = Date.now()) {
    const { days } = bucketScheduleByDate(scheduleDays || {}, timezone, new Date(now));
    const today = getZonedCalendarToday(timezone, new Date(now));
    return Array.from({ length: SCHEDULE_DAYS }, (_, offset) => {
        const date = new Date(today.getTime() + offset * DAY_MS);
        const shows = (days[offset] || [])
            .filter((anime) => LISTED.has(anime.user_list_status?.status))
            .map((anime) => {
                const at = Date.parse(anime.next_airing_date);
                const timed = Number.isFinite(at);
                return { anime, at: timed ? at : null, aired: timed && at <= now };
            });
        return {
            offset,
            label: offset === 0
                ? 'Today'
                : offset === 1
                    ? 'Tomorrow'
                    : date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
            date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
            shows,
        };
    }).filter((day) => day.shows.length > 0);
}

/**
 * The guest "Airing today" preview: today's timed episodes (ones that already
 * aired included), filled up to `limit` with the next upcoming episodes of
 * the coming days; shows without a time only when nothing else is known.
 * When today has more than `limit`, the ones still to air win, then the most
 * recently aired. Rows come back in time order, each with `offset` (days from
 * today) and `aired`.
 */
export function airingPreview(scheduleDays, timezone, now = Date.now(), limit = 5) {
    const { days } = bucketScheduleByDate(scheduleDays || {}, timezone, new Date(now));
    const timed = [];
    const untimed = [];
    days.forEach((items, offset) => items.forEach((anime) => {
        const at = Date.parse(anime.next_airing_date);
        if (Number.isFinite(at)) timed.push({ anime, at, offset, aired: at <= now });
        else if (offset === 0) untimed.push({ anime, at: null, offset, aired: false });
    }));
    const upcoming = timed.filter((row) => !row.aired).sort((a, b) => a.at - b.at);
    const airedToday = timed.filter((row) => row.aired && row.offset === 0).sort((a, b) => b.at - a.at);
    const upcomingToday = upcoming.filter((row) => row.offset === 0);
    const later = upcoming.filter((row) => row.offset > 0);
    const picked = [...upcomingToday, ...airedToday].slice(0, limit);
    picked.push(...later.slice(0, limit - picked.length));
    picked.sort((a, b) => a.at - b.at);
    if (picked.length === 0) return untimed.slice(0, limit);
    return picked;
}

/** "Aired 15:04", "17:43", "Tomorrow 14:43", "Mon 14:43", "Time TBA". */
export function previewWhen(row, timezone) {
    if (row.at === null) return 'Time TBA';
    const time = clockTime(row.at, timezone);
    if (row.offset === 0) return row.aired ? `Aired ${time}` : time;
    if (row.offset === 1) return `Tomorrow ${time}`;
    return `${formatDate(row.at, { weekday: 'short' }, timezone)} ${time}`;
}
