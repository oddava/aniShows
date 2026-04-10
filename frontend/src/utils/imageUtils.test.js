import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageUrl,
    getOptimizedImageUrl,
} from './imageUtils';

describe('imageUtils failover behavior', () => {
    it('prefers external URLs for cover fallback', () => {
        const anime = {
            title: 'Sample',
            cover_image: '/media/anime/covers/sample.jpg',
            cover_image_external_url: 'https://img.anilist.co/sample-cover.jpg',
            banner_image_external_url: 'https://img.anilist.co/sample-banner.jpg',
        };

        const fallback = getImageFallbackUrl(anime, 'cover');
        expect(fallback).toBe('https://img.anilist.co/sample-cover.jpg');
    });

    it('cache-busts local media source before applying fallback', () => {
        const img = {
            currentSrc: 'https://anishows.com/media/anime/covers/broken.jpg',
            src: 'https://anishows.com/media/anime/covers/broken.jpg',
            dataset: {},
            removeAttribute: vi.fn(),
        };

        applyImageFallback({ currentTarget: img }, 'https://img.anilist.co/fallback.jpg');

        expect(img.dataset.cacheBusted).toBe('1');
        expect(img.dataset.fallbackApplied).toBeUndefined();
        expect(img.src).toContain('https://anishows.com/media/anime/covers/broken.jpg?cb=');
    });

    it('applies fallback after cache-bust retry fails', () => {
        const img = {
            currentSrc: 'https://anishows.com/media/anime/covers/broken.jpg?cb=1',
            src: 'https://anishows.com/media/anime/covers/broken.jpg?cb=1',
            dataset: { cacheBusted: '1' },
            removeAttribute: vi.fn(),
        };

        applyImageFallback({ currentTarget: img }, 'https://img.anilist.co/fallback.jpg');

        expect(img.dataset.fallbackApplied).toBe('1');
        expect(img.src).toBe('https://img.anilist.co/fallback.jpg');
    });

    it('normalizes blank-like URL values to placeholder', () => {
        const placeholder = getImageUrl('   ', 'Blank');
        const nullLike = getImageUrl('null', 'NullLike');
        const undefinedLike = getImageUrl('undefined', 'UndefinedLike');

        expect(placeholder).toContain('data:image/svg+xml');
        expect(nullLike).toContain('data:image/svg+xml');
        expect(undefinedLike).toContain('data:image/svg+xml');
    });

    it('uses external image as optimized fallback when local sizes are missing', () => {
        const anime = {
            title: 'External Only',
            cover_image_small: null,
            cover_image_medium: null,
            cover_image: null,
            cover_image_external_url: 'https://img.anilist.co/external-only.jpg',
        };

        const optimized = getOptimizedImageUrl(anime, 'cover', 'small');
        expect(optimized).toBe('https://img.anilist.co/external-only.jpg');
    });
});
