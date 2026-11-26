import { describe, expect, it } from 'vitest';
import { dominantTextColor } from '../coverAccent';
import { getImageSrcSet } from '../imageUtils';

const pixels = (...runs) => runs.flatMap(([count, rgb]) => Array.from({ length: count }, () => [...rgb, 255])).flat();

const hsl = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, l };
};

describe('dominantTextColor', () => {
    it('picks the most common colourful hue, not the average', () => {
        // Mostly orange sky, some green, lots of black: orange should win.
        const color = dominantTextColor(pixels([60, [230, 140, 40]], [25, [40, 160, 60]], [100, [5, 5, 8]]));
        const { h } = hsl(color);
        expect(h).toBeGreaterThan(20);
        expect(h).toBeLessThan(45);
    });

    it('lifts dark colours so the title stays readable on the dark page', () => {
        const { l } = hsl(dominantTextColor(pixels([80, [60, 20, 90]])));
        expect(l).toBeGreaterThanOrEqual(0.69);
        expect(l).toBeLessThanOrEqual(0.81);
    });

    it('returns null for a greyscale cover', () => {
        expect(dominantTextColor(pixels([50, [20, 20, 20]], [50, [200, 200, 200]], [50, [120, 121, 119]]))).toBeNull();
    });
});

describe('getImageSrcSet banner', () => {
    it('offers the original banner so wide screens are not upscaled', () => {
        const srcset = getImageSrcSet({
            banner_image_small: '/media/b-s.webp',
            banner_image_medium: '/media/b-m.webp',
            banner_image_large: '/media/b-l.webp',
            banner_image: '/media/b.jpg',
        }, 'banner');
        expect(srcset).toContain('/media/b-l.webp 1200w');
        expect(srcset).toContain('/media/b.jpg 1900w');
    });

    it('falls back to the external banner and never lists a URL twice', () => {
        const srcset = getImageSrcSet({ banner_image_external_url: 'https://cdn.example/b.jpg' }, 'banner');
        expect(srcset).toBe('https://cdn.example/b.jpg 1900w');
    });

    it('leaves cover srcsets alone', () => {
        const srcset = getImageSrcSet({ cover_image_large: '/media/c-l.webp', cover_image: '/media/c.jpg' }, 'cover');
        expect(srcset).toBe('/media/c-l.webp 300w');
    });
});
