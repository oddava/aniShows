import { describe, expect, it } from 'vitest';
import { AURA_TIERS, statAura } from '../statAura';

describe('statAura', () => {
    it('has no aura below the first threshold', () => {
        expect(statAura('anime', 0)).toEqual({ tier: 0, color: null, name: null });
        expect(statAura('anime', 24)).toMatchObject({ tier: 0 });
    });

    it('climbs one tier at each threshold', () => {
        expect(statAura('anime', 25)).toMatchObject({ tier: 1, name: 'Green' });
        expect(statAura('anime', 61)).toMatchObject({ tier: 1 });
        expect(statAura('episodes', 700)).toMatchObject({ tier: 1 });
        expect(statAura('episodes', 4000)).toMatchObject({ tier: 3, name: 'Purple' });
    });

    it('tops out at the last tier', () => {
        expect(statAura('days', 9999)).toMatchObject({ tier: AURA_TIERS.length, name: 'Ruby' });
    });

    it('treats unknown metrics and junk as no aura', () => {
        expect(statAura('mystery', 1e9)).toMatchObject({ tier: 0 });
        expect(statAura('anime', 'lots')).toMatchObject({ tier: 0 });
    });
});
