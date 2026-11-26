import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileHeader from '../ProfileHeader';

vi.mock('../NowWatchingCard', () => ({ default: () => null }));
vi.mock('../../FollowButton', () => ({ default: () => <button type="button">Follow</button> }));

const USER = {
    username: 'oddava',
    status_emoji: '🎧',
    status_text: 'chilling',
    followers_count: 3,
    following_count: 4,
    social_links: [
        { platform: 'X', url: 'https://x.com/oddava', trust_level: 'verified' },
        { platform: 'Website', url: 'https://oddava.me', trust_level: 'unknown' },
    ],
};

const renderHeader = (props) => render(
    <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
            <ProfileHeader displayUser={USER} targetUsername="oddava" onOpenFollowersModal={() => {}} {...props} />
        </MemoryRouter>
    </QueryClientProvider>,
);

describe('ProfileHeader', () => {
    it('lays the links out as one wrapping, left-aligned row at every width', () => {
        renderHeader({ isPublicView: true });

        const row = screen.getByTestId('profile-links');
        // Not a two-column grid on phones: that put "Website" halfway across.
        expect(row.className).toMatch(/(^|\s)flex(\s|$)/);
        expect(row.className).toContain('flex-wrap');
        expect(row.className).toContain('justify-start');
        expect(row.className).not.toMatch(/grid|justify-between|justify-around/);
        const links = within(row).getAllByRole('link');
        expect(links.map((link) => link.textContent)).toEqual(['@oddava', 'Website']);
    });
});
