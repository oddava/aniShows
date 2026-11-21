import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import CoverThumb, { animeCoverSources } from '../../ui/CoverThumb';
import { roleLabel } from '../RoleRows';

describe('roleLabel', () => {
    it('puts all-caps roles in sentence case and keeps mixed case as is', () => {
        expect(roleLabel('MAIN')).toBe('Main');
        expect(roleLabel('SUPPORTING')).toBe('Supporting');
        expect(roleLabel('BACKGROUND_EXTRA')).toBe('Background extra');
        expect(roleLabel('ADR Director')).toBe('ADR Director');
        expect(roleLabel('')).toBe('');
    });
});

describe('CoverThumb', () => {
    const anime = {
        title: 'Ranma ½ (2024)',
        cover_image_small: '/media/CACHE/small.webp',
        cover_image: '/media/covers/original.jpg',
    };

    it('tries the optimised cover, then the original, then leaves a quiet slot', () => {
        const { container } = render(<CoverThumb sources={animeCoverSources(anime)} />);

        let img = container.querySelector('img');
        expect(img.getAttribute('src')).toContain('/media/CACHE/small.webp');
        expect(img).toHaveAttribute('data-loaded', 'false');

        fireEvent.error(img);
        img = container.querySelector('img');
        expect(img.getAttribute('src')).toContain('/media/covers/original.jpg');

        fireEvent.error(img);
        // Nothing left to try: no <img>, so no broken icon and no alt text.
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('fades the image in once it has loaded', () => {
        const { container } = render(<CoverThumb sources={animeCoverSources(anime)} />);
        const img = container.querySelector('img');
        fireEvent.load(img);
        expect(img).toHaveAttribute('data-loaded', 'true');
    });

    it('skips blank sources', () => {
        expect(animeCoverSources({ cover_image_small: '', cover_image: 'null' })).toEqual([]);
        const { container } = render(<CoverThumb sources={[]} />);
        expect(container.querySelector('img')).toBeNull();
    });
});
