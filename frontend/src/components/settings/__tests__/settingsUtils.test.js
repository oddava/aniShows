import { describe, expect, it } from 'vitest';
import { BANNER_ASPECT, fitsBannerAspect } from '../settingsUtils';

describe('banner shape', () => {
    it('crops banners to 3:1', () => {
        expect(BANNER_ASPECT).toBe(3);
    });

    it('takes a 3:1 banner as it is, with a little give either way', () => {
        expect(fitsBannerAspect(1500, 500)).toBe(true);
        expect(fitsBannerAspect(1600, 500)).toBe(true);
        expect(fitsBannerAspect(1400, 500)).toBe(true);
    });

    it('sends other shapes to the cropper', () => {
        expect(fitsBannerAspect(1920, 1080)).toBe(false);
        expect(fitsBannerAspect(2900, 500)).toBe(false);
        expect(fitsBannerAspect(0, 500)).toBe(false);
    });
});
