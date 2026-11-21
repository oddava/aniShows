import { describe, it, expect } from 'vitest';
import { tidyActivities } from '../activityTidy';

const BASE = Date.parse('2026-11-21T09:00:00Z');
let nextId = 1;
const at = (minutes) => new Date(BASE + minutes * 60 * 1000).toISOString();
const ev = (animeId, minutes, type, extra = {}) => ({
    id: nextId++,
    anime: { id: animeId, slug: `show-${animeId}`, title: `Show ${animeId}` },
    activity_type: type,
    created_at: at(minutes),
    old_status: null,
    new_status: null,
    ...extra,
});
const ids = (rows) => rows.map((row) => row.id);

describe('tidyActivities', () => {
    it('hides every event of a show whose newest event is a removal', () => {
        // ux_fresh: added, removed, added, removed… and nothing left on the list.
        const feed = [
            ev(4, 50, 'removed', { old_status: 'Completed' }),
            ev(4, 49, 'completed', { new_status: 'Completed' }),
            ev(3, 40, 'removed', { old_status: 'Watching' }),
            ev(3, 39, 'added', { new_status: 'Watching' }),
            ev(4, 10, 'removed', { old_status: 'Plan to Watch' }),
            ev(4, 9, 'added', { new_status: 'Plan to Watch' }),
        ];
        expect(tidyActivities(feed)).toEqual([]);
        expect(tidyActivities(feed, { isOwner: true })).toEqual([]);
    });

    it('drops a removal that was undone, keeping the re-add', () => {
        const added = ev(2, 200, 'added', { new_status: 'Watching' });
        const feed = [added, ev(2, 10, 'removed', { old_status: 'Watching' }), ev(2, 0, 'added', { new_status: 'Watching' })];
        expect(ids(tidyActivities(feed))).toEqual([added.id, feed[2].id]);
    });

    it('shows the owner a removal only when it is the only event', () => {
        const only = [ev(9, 0, 'removed', { old_status: 'Watching' })];
        expect(tidyActivities(only, { isOwner: true })).toEqual(only);
        expect(tidyActivities(only)).toEqual([]);
    });

    it('drops a burst that ends where it started (Completed → Watching → Completed)', () => {
        const later = ev(4, 90, 'completed', { old_status: 'Watching', new_status: 'Completed' });
        const feed = [
            later,
            ev(4, 1, 'status_change', { old_status: 'Completed', new_status: 'Watching' }),
            ev(4, 0.5, 'completed', { old_status: 'Watching', new_status: 'Completed' }),
            ev(4, 0.2, 'status_change', { old_status: 'Completed', new_status: 'Watching' }),
            ev(4, 0, 'completed', { old_status: 'Watching', new_status: 'Completed' }),
        ];
        // The burst nets Watching → Watching; the completion 90 minutes later stays.
        expect(ids(tidyActivities(feed))).toEqual([later.id]);
    });

    it('turns a burst of status changes into one row with the final state', () => {
        const feed = [
            ev(5, 20, 'status_change', { old_status: 'On Hold', new_status: 'Dropped' }),
            ev(5, 0, 'status_change', { old_status: 'Watching', new_status: 'On Hold' }),
        ];
        const [row] = tidyActivities(feed);
        expect(tidyActivities(feed)).toHaveLength(1);
        expect(row).toMatchObject({ old_status: 'Watching', new_status: 'Dropped', activity_description: 'Changed Show 5 from Watching to Dropped' });
    });

    it('reads "added" then moved along as added to where it ended up', () => {
        const feed = [
            ev(6, 5, 'status_change', { old_status: 'Plan to Watch', new_status: 'Watching' }),
            ev(6, 0, 'added', { new_status: 'Plan to Watch' }),
        ];
        expect(tidyActivities(feed)).toEqual([expect.objectContaining({ activity_type: 'added', new_status: 'Watching', activity_description: 'Added Show 6 to Watching' })]);
    });

    it('merges episode-by-episode progress into one stretch', () => {
        const feed = [
            ev(7, 50, 'progress', { old_episodes: 4, new_episodes: 5 }),
            ev(7, 25, 'progress', { old_episodes: 3, new_episodes: 4 }),
            ev(7, 0, 'progress', { old_episodes: 2, new_episodes: 3 }),
        ];
        expect(tidyActivities(feed)).toEqual([expect.objectContaining({ old_episodes: 2, new_episodes: 5, activity_description: 'Watched episodes 3-5 of Show 7' })]);
    });

    it('keeps events more than an hour apart, and events for other shows in between', () => {
        const feed = [
            ev(8, 200, 'progress', { old_episodes: 1, new_episodes: 2 }),
            ev(8, 100, 'progress', { old_episodes: 0, new_episodes: 1 }),
            ev(1, 50, 'added', { new_status: 'Watching' }),
            ev(8, 40, 'added', { new_status: 'Watching' }),
        ];
        expect(tidyActivities(feed)).toHaveLength(4);
    });
});
