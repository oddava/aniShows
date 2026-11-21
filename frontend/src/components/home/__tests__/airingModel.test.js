import { describe, expect, it } from 'vitest';
import { airingPreview, listedAirings, previewWhen, tonightFrom, weekAgenda } from '../airingModel';
import { continueState } from '../continueModel';

// Saturday 2026-11-21 10:35 UTC.
const NOW = Date.parse('2026-11-21T10:35:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms) => new Date(NOW + ms).toISOString();
const anime = (id, nextAt, extra = {}) => ({
    id,
    slug: `show-${id}`,
    title: `Show ${id}`,
    next_airing_episode: 9,
    next_airing_date: nextAt,
    user_list_status: { status: 'Watching' },
    ...extra,
});

describe('continueState', () => {
    it('says the episode is out once its airing time has passed', () => {
        const entry = { episodes_watched: 8, anime: { ...anime(1, at(-31 * 60 * 1000)), episode_count: 24 } };
        expect(continueState(entry, NOW)).toMatchObject({ kind: 'ready', behind: 1, nextEpisode: 9 });
    });

    it('waits for an episode still to come', () => {
        const entry = { episodes_watched: 8, anime: { ...anime(1, at(2 * HOUR)), episode_count: 24 } };
        expect(continueState(entry, NOW)).toMatchObject({ kind: 'soon', nextEpisode: 9, nextAt: NOW + 2 * HOUR });
    });
});

describe('tonightFrom', () => {
    it("lists today's episodes in time order, aired ones included", () => {
        const airings = listedAirings(
            [{ anime: anime(1, at(-31 * 60 * 1000)) }],
            { saturday: [anime(2, at(2 * HOUR), { next_airing_episode: 4 }), anime(3, at(2 * HOUR), { user_list_status: null })] },
        );
        const { today, next } = tonightFrom(airings, NOW, 'UTC');
        expect(today.map((row) => [row.anime.id, row.aired])).toEqual([[1, true], [2, false]]);
        // The next one still to come is today's later episode.
        expect(next.anime.id).toBe(2);
    });

    it('names the next show when nothing airs today', () => {
        const airings = listedAirings([{ anime: anime(1, at(DAY + HOUR)) }, { anime: anime(2, at(3 * DAY)) }], {});
        const { today, next } = tonightFrom(airings, NOW, 'UTC');
        expect(today).toEqual([]);
        expect(next.anime.id).toBe(1);
    });

    it('reads "today" in the viewer zone', () => {
        // 20:00 UTC is already Sunday in Tokyo, but still Saturday in UTC.
        const airings = listedAirings([{ anime: anime(1, '2026-11-21T20:00:00Z') }], {});
        expect(tonightFrom(airings, NOW, 'UTC').today).toHaveLength(1);
        expect(tonightFrom(airings, NOW, 'Asia/Tokyo').today).toHaveLength(0);
    });
});

describe('weekAgenda', () => {
    it('keeps only days with a listed show and marks what already aired', () => {
        const days = weekAgenda({
            saturday: [anime(1, at(-HOUR)), anime(2, at(HOUR))],
            monday: [anime(3, at(2 * DAY), { user_list_status: { status: 'Plan to Watch' } })],
            tuesday: [anime(4, at(3 * DAY), { user_list_status: null })],
        }, 'UTC', NOW);
        expect(days.map((day) => day.label)).toEqual(['Today', 'Monday']);
        expect(days[0].shows.map((row) => [row.anime.id, row.aired])).toEqual([[1, true], [2, false]]);
        expect(days[1].date).toBe('23 Nov');
    });
});

describe('airingPreview', () => {
    it('fills up to five with the next upcoming episodes instead of untimed rows', () => {
        const rows = airingPreview({
            saturday: [anime(1, at(-HOUR)), anime(2, at(HOUR)), anime(9, null, { broadcast_day: 'Saturday' })],
            sunday: [anime(3, at(DAY)), anime(4, at(DAY + HOUR))],
            tuesday: [anime(5, at(3 * DAY)), anime(6, at(3 * DAY + HOUR))],
        }, 'UTC', NOW);
        expect(rows.map((row) => row.anime.id)).toEqual([1, 2, 3, 4, 5]);
        expect(rows.map((row) => previewWhen(row, 'UTC'))).toEqual([
            'Aired 09:35', '11:35', 'Tomorrow 10:35', 'Tomorrow 11:35', 'Tue 10:35',
        ]);
    });

    it('prefers what is still to air when today alone has more than five', () => {
        const saturday = [-5, -4, -3, -2, -1, 1, 2].map((h, i) => anime(i + 1, at(h * HOUR)));
        const rows = airingPreview({ saturday }, 'UTC', NOW);
        expect(rows.map((row) => row.anime.id)).toEqual([3, 4, 5, 6, 7]);
    });

    it('shows untimed rows only when nothing else is known', () => {
        const rows = airingPreview({ saturday: [anime(9, null, { broadcast_day: 'Saturday' })] }, 'UTC', NOW);
        expect(rows.map((row) => previewWhen(row, 'UTC'))).toEqual(['Time TBA']);
    });
});
