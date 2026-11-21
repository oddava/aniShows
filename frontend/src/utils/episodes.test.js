import { describe, expect, it } from 'vitest';
import { airedEpisodeCount, airingState, progressText } from './episodes';

const NOW = Date.parse('2026-11-21T10:35:00Z');
const MIN = 60 * 1000;
const show = (extra) => ({ episode_count: 24, next_airing_episode: 9, ...extra });

describe('airingState', () => {
    it('counts the episodes before the next one while it is still to come', () => {
        const state = airingState(show({ next_airing_date: new Date(NOW + 2 * 60 * MIN).toISOString() }), NOW);
        expect(state).toMatchObject({ aired: 8, justAired: false, nextEpisode: 9, nextAt: NOW + 2 * 60 * MIN });
    });

    it('counts the listed episode once its airing time has passed (API not synced yet)', () => {
        const airedAt = NOW - 31 * MIN;
        const state = airingState(show({ next_airing_date: new Date(airedAt).toISOString() }), NOW);
        expect(state).toMatchObject({ aired: 9, justAired: true, airedAt, nextEpisode: 10, nextAt: null });
    });

    it('treats the exact airing time as aired', () => {
        expect(airingState(show({ next_airing_date: new Date(NOW).toISOString() }), NOW).aired).toBe(9);
    });

    it('never counts past the known total', () => {
        const last = show({ episode_count: 9, next_airing_date: new Date(NOW - MIN).toISOString() });
        expect(airingState(last, NOW)).toMatchObject({ aired: 9, nextEpisode: null });
        expect(airingState(show({ episode_count: 6, next_airing_date: null }), NOW).aired).toBe(6);
    });

    it('is unknown without a next episode, and zero aired reads as unknown', () => {
        expect(airingState({ episode_count: 12 }, NOW).aired).toBeNull();
        const premiere = show({ next_airing_episode: 1, next_airing_date: new Date(NOW + MIN).toISOString() });
        expect(airingState(premiere, NOW).aired).toBeNull();
        const premiered = show({ next_airing_episode: 1, next_airing_date: new Date(NOW - MIN).toISOString() });
        expect(airingState(premiered, NOW).aired).toBe(1);
    });

    it('keeps the date-less behaviour: next minus one', () => {
        expect(airingState(show({ next_airing_date: null }), NOW)).toMatchObject({ aired: 8, nextEpisode: 9, nextAt: null });
    });
});

describe('airedEpisodeCount', () => {
    it('follows airingState and accepts a Date for now', () => {
        const anime = { next_airing_episode: 1101, next_airing_date: '2026-11-21T10:00:00Z' };
        expect(airedEpisodeCount(anime, NOW)).toBe(1101);
        expect(airedEpisodeCount(anime, new Date('2026-11-21T09:00:00Z'))).toBe(1100);
        expect(progressText(1000, { next_airing_episode: 1101 })).toBe('Ep 1000 / 1100 aired');
    });
});
