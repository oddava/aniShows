import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminUsers from '../AdminUsers';

const getMock = vi.fn();

vi.mock('../../../api/client', () => ({ default: { get: (...args) => getMock(...args) } }));

const user = (id) => ({
    id,
    username: `user${id}`,
    email: `user${id}@example.com`,
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: '2026-01-01T00:00:00Z',
});

const pageOf = (url) => new URL(url, 'http://x').searchParams.get('page');

describe('AdminUsers', () => {
    beforeEach(() => getMock.mockReset());

    it('goes back to page 1 when the search changes', async () => {
        getMock.mockResolvedValue({ data: { results: [user(1)], count: 60 } });
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByText(/Next/));
        await waitFor(() => expect(pageOf(getMock.mock.calls.at(-1)[0])).toBe('2'));

        fireEvent.change(screen.getByPlaceholderText(/Search users/), { target: { value: 'ali' } });

        await waitFor(() => {
            const url = getMock.mock.calls.at(-1)[0];
            expect(url).toContain('search=ali');
            expect(pageOf(url)).toBe('1');
        });
    });

    it('steps back instead of showing an error when the page no longer exists', async () => {
        getMock.mockImplementation((url) =>
            pageOf(url) === '2'
                ? Promise.reject({ response: { status: 404, data: { detail: 'Invalid page.' } } })
                : Promise.resolve({ data: { results: [user(1)], count: 60 } }),
        );
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByText(/Next/));

        await waitFor(() => expect(pageOf(getMock.mock.calls.at(-1)[0])).toBe('1'));
        expect(screen.queryByText('Error Loading Users')).toBeNull();
        expect(await screen.findByText('user1')).toBeTruthy();
    });
});
