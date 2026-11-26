import { describe, expect, it } from 'vitest';
import { formatResultCount } from '../resultCount';

describe('formatResultCount (BUG-009)', () => {
    it('says how many results there are', () => {
        expect(formatResultCount(1)).toBe('1 result');
        expect(formatResultCount(248)).toBe('248 results');
        expect(formatResultCount(1500)).toBe('1,500 results');
    });

    it('marks a count the API stopped at', () => {
        expect(formatResultCount(2000, true)).toBe('2,000+ results');
    });
});
