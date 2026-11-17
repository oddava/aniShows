import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminLayout from '../../../components/AdminLayout';

vi.mock('../../../api/client', () => ({
    default: { get: vi.fn(() => Promise.resolve({ data: { open_reviews: 3, forums: null } })) },
}));
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { username: 'mod', is_staff: true, is_superuser: false }, logout: vi.fn() }),
}));

const renderLayout = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin']}>
            <AdminLayout />
        </MemoryRouter>
    </QueryClientProvider>,
);

describe('AdminLayout', () => {
    it('takes the closed phone sidebar out of the tab order until it is opened', () => {
        renderLayout();
        const sidebar = document.getElementById('admin-sidebar');
        expect(sidebar.className).toMatch(/(^|\s)invisible(\s|$)/);
        expect(sidebar.className).toMatch(/lg:visible/);

        const toggle = screen.getByRole('button', { expanded: false });
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(sidebar.className).not.toMatch(/(^|\s)invisible(\s|$)/);
    });

    it('announces the moderation badge as text, not an ignored aria-label', async () => {
        renderLayout();
        expect(await screen.findByText(', 3 open', {}, { timeout: 5000 })).toHaveClass('sr-only');
    });
});
