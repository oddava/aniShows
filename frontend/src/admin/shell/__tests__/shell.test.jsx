import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ value: { user: null, loading: false, isAuthenticated: true, logout: vi.fn() } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth.value }));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, adminApi: { ...actual.adminApi, get: api.get } };
});

vi.mock('../../../components/common/RouteProgress', () => ({ default: () => null }));

import AdminShell from '../AdminShell';
import AdminGate from '../AdminGate';
import { flatNav, navFor } from '../nav';

const SUPERUSER = { id: 1, username: 'root', is_staff: true, is_superuser: true };
const STAFF = { id: 2, username: 'mod', is_staff: true, is_superuser: false };

function renderShell(path = '/admin') {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/admin" element={<AdminShell />}>
                        <Route index element={<p>Dashboard page</p>} />
                        <Route path="users" element={<p>Users page</p>} />
                        <Route path="users/:id" element={<p>User page</p>} />
                    </Route>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    api.get.mockReset();
    api.get.mockImplementation((path) => {
        if (path === 'moderation/summary') return Promise.resolve({ open_reviews: 4, open_reports: 6, forums: null });
        if (path === 'search') {
            return Promise.resolve({
                users: [{ id: 9, username: 'mika', email: 'mika@example.com', is_active: true }],
                anime: [],
                reviews: [],
                threads: [],
            });
        }
        return Promise.resolve({});
    });
});

describe('nav', () => {
    it('hides superuser-only sections from staff', () => {
        const staffLabels = flatNav({ isSuperuser: false }).map((item) => item.label);
        expect(staffLabels).toContain('Moderation');
        expect(staffLabels).not.toContain('Task history');
        expect(navFor({ isSuperuser: false }).flatMap((s) => s.items).some((item) => item.external)).toBe(false);
        expect(flatNav({ isSuperuser: true }).map((item) => item.label)).toContain('Task history');
    });
});

describe('AdminShell', () => {
    it('marks the current page and shows the open moderation count', async () => {
        auth.value = { ...auth.value, user: SUPERUSER };
        renderShell('/admin/users/9');
        const nav = screen.getByRole('navigation', { name: 'Admin' });
        expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
        expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
        expect(await within(nav).findByText(', 4 open')).toBeInTheDocument();
        expect(screen.getByText('User page')).toBeInTheDocument();
    });

    it('opens search with Ctrl K and goes to a result', async () => {
        auth.value = { ...auth.value, user: STAFF };
        renderShell('/admin');
        await userEvent.keyboard('{Control>}k{/Control}');
        const input = await screen.findByRole('combobox');
        await userEvent.type(input, 'mika');
        expect(await screen.findByRole('option', { name: /mika/ })).toBeInTheDocument();
        await userEvent.keyboard('{Enter}');
        expect(await screen.findByText('User page')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('search', { q: 'mika' }, expect.anything());
    });

    it('filters pages by name in search', async () => {
        auth.value = { ...auth.value, user: STAFF };
        renderShell('/admin');
        await userEvent.click(screen.getAllByRole('button', { name: /Search/ })[0]);
        await userEvent.type(await screen.findByRole('combobox'), 'us');
        const option = screen.getByRole('option', { name: 'Users' });
        await userEvent.click(option);
        expect(await screen.findByText('Users page')).toBeInTheDocument();
    });
});

describe('phone menu', () => {
    it('is modal: focus stays inside, the page behind is inert, Escape returns focus', async () => {
        auth.value = { ...auth.value, user: STAFF };
        renderShell('/admin');
        const opener = screen.getByRole('button', { name: 'Open admin menu' });
        await userEvent.click(opener);
        const sheet = screen.getByRole('dialog', { name: 'Admin menu' });
        expect(sheet.contains(document.activeElement)).toBe(true);
        expect(document.getElementById('admin-main')).toHaveAttribute('inert');
        for (let step = 0; step < 30; step += 1) {
            await userEvent.tab();
            expect(sheet.contains(document.activeElement)).toBe(true);
        }
        await userEvent.keyboard('{Escape}');
        expect(opener).toHaveFocus();
        expect(document.getElementById('admin-main')).not.toHaveAttribute('inert');
    });
});

describe('AdminGate', () => {
    function renderGate() {
        return render(
            <MemoryRouter initialEntries={['/admin']}>
                <Routes>
                    <Route path="/admin" element={<AdminGate><p>Inside</p></AdminGate>} />
                    <Route path="/login" element={<p>Sign in</p>} />
                    <Route path="/" element={<p>Home</p>} />
                </Routes>
            </MemoryRouter>,
        );
    }

    it('sends signed-out visitors to sign in and members home', () => {
        auth.value = { user: null, loading: false, isAuthenticated: false };
        const { unmount } = renderGate();
        expect(screen.getByText('Sign in')).toBeInTheDocument();
        unmount();
        auth.value = { user: { id: 3, is_staff: false }, loading: false, isAuthenticated: true };
        renderGate();
        expect(screen.getByText('Home')).toBeInTheDocument();
    });

    it('lets staff in', () => {
        auth.value = { user: STAFF, loading: false, isAuthenticated: true };
        renderGate();
        expect(screen.getByText('Inside')).toBeInTheDocument();
    });
});
