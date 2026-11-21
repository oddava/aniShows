import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileNav from '../MobileNav';

function renderNav(path = '/browse', props = {}) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <MobileNav isAuthenticated mobileUnreadCount={0} {...props} />
        </MemoryRouter>,
    );
}

describe('MobileNav (M5)', () => {
    it('puts My List one tap away, next to Home, Browse, Schedule and Notifications', () => {
        renderNav('/browse');
        const nav = screen.getByRole('navigation', { name: 'Primary' });
        const labels = Array.from(nav.querySelectorAll('a')).map((link) => link.textContent);
        expect(labels).toEqual(['Home', 'Browse', 'Schedule', 'My List', 'Alerts']);
        expect(screen.getByRole('link', { name: 'My List' })).toHaveAttribute('href', '/list');
        expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('aria-current', 'page');
    });

    it('marks My List current on the library and announces unread notifications', () => {
        renderNav('/list', { mobileUnreadCount: 12 });
        expect(screen.getByRole('link', { name: 'My List' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Alerts, 12 unread' })).toBeInTheDocument();
        expect(screen.getByText('9+')).toBeInTheDocument();
    });

    it('offers Sign in to guests instead of the list and notifications', () => {
        renderNav('/', { isAuthenticated: false });
        expect(screen.queryByRole('link', { name: 'My List' })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    });

    it('stays out of the way on pages outside the main sections', () => {
        renderNav('/anime/frieren');
        expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    });
});
