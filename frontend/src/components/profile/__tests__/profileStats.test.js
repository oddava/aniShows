import { describe, expect, it } from 'vitest';
import { profileScore } from '../profileStats';

describe('profileScore', () => {
    it('uses the profile payload when it carries rated_count', () => {
        expect(profileScore({ mean_score: 7.7, rated_count: 3 }, { mean_score: 5, rated_count: 9 }))
            .toEqual({ mean: '7.7', rated: 3 });
    });

    it('falls back to the list summary for both numbers when rated_count is missing', () => {
        // The old bug: a mean from the profile, "nothing rated" from elsewhere.
        expect(profileScore({ mean_score: 7.7 }, { mean_score: 7.7, rated_count: 3 }))
            .toEqual({ mean: '7.7', rated: 3 });
    });

    it('counts the summary histogram when the summary has no rated_count', () => {
        expect(profileScore({}, { mean_score: 8, score_histogram: { 8: 2, 9: 0, 7: '1' } }))
            .toEqual({ mean: '8.0', rated: 3 });
    });

    it('shows no mean when nothing is rated', () => {
        expect(profileScore({ mean_score: 7.7, rated_count: 0 })).toEqual({ mean: null, rated: 0 });
        expect(profileScore({}, undefined)).toEqual({ mean: null, rated: 0 });
    });
});
