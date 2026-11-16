import { describe, it, expect } from 'vitest';

import { profileQueries, profileQueryRetry } from '../profile';

const httpError = (status) => ({ response: { status } });

describe('profileQueryRetry', () => {
    it.each([400, 401, 403, 404, 429])('does not retry a %i', (status) => {
        expect(profileQueryRetry(0, httpError(status))).toBe(false);
    });

    it('retries a server error at most twice', () => {
        expect(profileQueryRetry(0, httpError(500))).toBe(true);
        expect(profileQueryRetry(1, httpError(503))).toBe(true);
        expect(profileQueryRetry(2, httpError(502))).toBe(false);
    });

    it('does not retry an error without a response', () => {
        expect(profileQueryRetry(0, new Error('network'))).toBe(false);
    });

    it('is the policy of both profile queries', () => {
        expect(profileQueries.own().retry).toBe(profileQueryRetry);
        expect(profileQueries.byUsername('kiyo').retry).toBe(profileQueryRetry);
    });
});
