import { describe, expect, it } from 'vitest';
import { genreLine, profileScore } from '../profileStats';

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

describe('genreLine', () => {
    it('reads the top three genres as one sentence-case line', () => {
        expect(genreLine([
            { name: 'Fantasy', count: 4 },
            { name: 'Romance', count: 3 },
            { name: 'Action', count: 2 },
            { name: 'Drama', count: 1 },
        ])).toBe('Mostly fantasy, romance and action');
    });

    it('handles one or two genres', () => {
        expect(genreLine([{ name: 'Sci-Fi', count: 2 }])).toBe('Mostly sci-fi');
        expect(genreLine([{ name: 'Slice of Life', count: 2 }, { name: 'Comedy', count: 1 }]))
            .toBe('Mostly slice of life and comedy');
    });

    it('says nothing without genres', () => {
        expect(genreLine([])).toBeNull();
        expect(genreLine(undefined)).toBeNull();
        expect(genreLine([{ name: 'Action', count: 0 }])).toBeNull();
    });
});
