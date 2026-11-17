import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SocialLinks from '../SocialLinks';

describe('SocialLinks', () => {
    it('marks a link flagged suspicious and drops its favicon', () => {
        render(
            <SocialLinks
                links={[
                    { platform: 'website', url: 'https://young.example', trust_level: 'suspicious', metadata: { favicon: 'https://young.example/f.ico' } },
                    { platform: 'github', url: 'https://github.com/x', trust_level: 'verified', metadata: {} },
                ]}
            />,
        );

        const flagged = screen.getByRole('link', { name: /website.*possibly unsafe/i });
        expect(flagged).toHaveAttribute('rel', expect.stringContaining('nofollow'));
        expect(flagged.querySelector('img')).toBeNull();

        const normal = screen.getByRole('link', { name: /github/i });
        expect(normal).toHaveAttribute('rel', 'noopener noreferrer');
    });
});
