import { describe, expect, it } from 'vitest';
import { getPasswordProblem } from './password';

describe('getPasswordProblem', () => {
    it('flags short and all-numeric passwords', () => {
        expect(getPasswordProblem('short')).toMatch(/at least 8/);
        expect(getPasswordProblem('12345678')).toMatch(/numeric/);
    });

    it('accepts passwords the server-side length and numeric rules accept', () => {
        expect(getPasswordProblem('N3w-Passphrase!')).toBeNull();
        expect(getPasswordProblem(' spaced  pass ')).toBeNull();
    });
});
