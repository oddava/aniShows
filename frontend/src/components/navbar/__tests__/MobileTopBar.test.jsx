import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MobileTopBar from '../MobileTopBar';

let auth = {};
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));

function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>;
}

const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <MobileTopBar />
        <Routes>
            <Route path="*" element={<Where />} />
        </Routes>
    </MemoryRouter>,
);

describe('MobileTopBar profile entry', () => {
    beforeEach(() => {
        auth = { isAuthenticated: true, user: { username: 'oddava', avatar: null } };
    });

    it('takes a signed-in user to their own profile in one tap, from any page', async () => {
        renderAt('/anime/frieren');

        const link = screen.getByRole('link', { name: 'Your profile (oddava)' });
        expect(link).toHaveAttribute('href', '/u/oddava');
        expect(link).not.toHaveAttribute('aria-current');

        await userEvent.click(link);
        expect(screen.getByTestId('where')).toHaveTextContent('/u/oddava');
    });

    it('is keyboard reachable and marks the current page on your profile', async () => {
        renderAt('/u/oddava');

        const link = screen.getByRole('link', { name: 'Your profile (oddava)' });
        expect(link).toHaveAttribute('aria-current', 'page');
        link.focus();
        expect(link).toHaveFocus();
    });

    it('shows the avatar picture when there is one, hidden from screen readers', () => {
        auth = { isAuthenticated: true, user: { username: 'oddava', avatar: '/media/avatars/a.webp' } };
        const { container } = renderAt('/');

        const img = container.querySelector('img[src="/media/avatars/a.webp"]');
        expect(img).toHaveAttribute('alt', '');
    });

    it('has no profile entry for guests', () => {
        auth = { isAuthenticated: false, user: null };
        renderAt('/');

        expect(screen.queryByRole('link', { name: /your profile/i })).not.toBeInTheDocument();
    });
});
