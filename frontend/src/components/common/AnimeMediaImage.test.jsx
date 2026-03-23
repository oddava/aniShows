import { fireEvent, render, screen } from '@testing-library/react';
import AnimeMediaImage from './AnimeMediaImage';

describe('AnimeMediaImage', () => {
    it('renders optimized source for requested size', () => {
        const anime = {
            title: 'Sample',
            cover_image_small: '/media/anime/covers/sample-small.jpg',
            cover_image: '/media/anime/covers/sample.jpg',
        };

        render(<AnimeMediaImage anime={anime} kind="cover" size="small" alt="Sample cover" />);
        const image = screen.getByAltText('Sample cover');

        expect(image.getAttribute('src')).toContain('/media/anime/covers/sample-small.jpg');
    });

    it('uses external fallback as source when local media is missing', () => {
        const anime = {
            title: 'External only',
            cover_image: null,
            cover_image_small: null,
            cover_image_external_url: 'https://img.anilist.co/external-only.jpg',
        };

        render(<AnimeMediaImage anime={anime} kind="cover" size="small" alt="External only cover" />);
        const image = screen.getByAltText('External only cover');

        expect(image.getAttribute('src')).toBe('https://img.anilist.co/external-only.jpg');
    });

    it('cache-busts local media first, then applies external fallback', () => {
        const anime = {
            title: 'Broken',
            cover_image_small: '/media/anime/covers/broken-small.jpg',
            cover_image: '/media/anime/covers/broken.jpg',
            cover_image_external_url: 'https://img.anilist.co/fallback.jpg',
        };

        render(<AnimeMediaImage anime={anime} kind="cover" size="small" alt="Broken cover" />);
        const image = screen.getByAltText('Broken cover');

        fireEvent.error(image);
        expect(image.getAttribute('src')).toContain('/media/anime/covers/broken-small.jpg?cb=');

        fireEvent.error(image);
        expect(image.getAttribute('src')).toBe('https://img.anilist.co/fallback.jpg');
    });
});
