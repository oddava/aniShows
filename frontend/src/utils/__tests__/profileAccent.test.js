import { describe, it, expect } from 'vitest';
import {
    MIN_ACCENT_CONTRAST,
    PROFILE_ACCENT_BACKGROUND,
    contrastRatio,
    getProfileAccentTheme,
    toneProfileAccentColor,
    DEFAULT_PROFILE_PRIMARY_COLOR,
    normalizeProfilePrimaryColor,
} from '../profileAccent';

// Deterministic PRNG (mulberry32) so the "random" colours are the same every run.
function mulberry32(seed) {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const random = mulberry32(20261116);
const RANDOM_COLOURS = Array.from({ length: 50 }, () =>
    `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`,
);

describe('toneProfileAccentColor', () => {
    it('computes WCAG contrast like the spec', () => {
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
        expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
    });

    it('lifts a near-black choice to a readable accent', () => {
        const toned = toneProfileAccentColor('#111111');
        expect(contrastRatio(toned, PROFILE_ACCENT_BACKGROUND)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    });

    it.each(RANDOM_COLOURS)('%s reaches 4.5:1 on the page background', (colour) => {
        const toned = toneProfileAccentColor(colour);
        expect(toned).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(toned, PROFILE_ACCENT_BACKGROUND)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    });

    it('keeps already-readable colours unchanged', () => {
        // Within the saturation/lightness caps and already above 4.5:1.
        expect(toneProfileAccentColor('#4fa3d1')).toBe('#4fa3d1');
    });

    it('keeps the hue when it raises lightness', () => {
        const toned = toneProfileAccentColor('#330000');
        const red = parseInt(toned.slice(1, 3), 16);
        const green = parseInt(toned.slice(3, 5), 16);
        const blue = parseInt(toned.slice(5, 7), 16);
        expect(red).toBeGreaterThan(green);
        expect(green).toBe(blue);
    });

    it('builds a theme whose light and dark shades are valid hex', () => {
        const theme = getProfileAccentTheme('#111111');
        expect(theme.baseColor).toBe(toneProfileAccentColor('#111111'));
        expect(theme.lightColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(theme.darkColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(theme.lightColor, PROFILE_ACCENT_BACKGROUND))
            .toBeGreaterThanOrEqual(contrastRatio(theme.baseColor, PROFILE_ACCENT_BACKGROUND));
    });
});

describe('default profile colour', () => {
    it('is the periwinkle accent, drawn unchanged', () => {
        expect(DEFAULT_PROFILE_PRIMARY_COLOR).toBe('#8db1ff');
        expect(toneProfileAccentColor(undefined)).toBe('#8db1ff');
    });

    it('maps the old violet and the retired lime defaults to it', () => {
        expect(normalizeProfilePrimaryColor('#8B5CF6')).toBe('#8db1ff');
        expect(normalizeProfilePrimaryColor('#d4f65a')).toBe('#8db1ff');
    });

    it('keeps a colour someone picked', () => {
        expect(normalizeProfilePrimaryColor('#EF4444')).toBe('#ef4444');
    });
});
