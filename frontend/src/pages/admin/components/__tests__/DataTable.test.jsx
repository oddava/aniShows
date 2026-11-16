import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import DataTable from '../DataTable';

const columns = [
    { key: 'username', title: 'Username', sortable: true },
    { key: 'email', title: 'Email' },
    { key: 'actions', title: 'Actions', render: (item) => <button type="button">Edit {item.username}</button> },
];
const rows = [
    { id: 1, username: 'alice', email: 'a@example.com' },
    { id: 2, username: 'bob', email: 'b@example.com' },
];

const mockMatchMedia = (matches) => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
};

const usernameHeader = () => screen.getByRole('columnheader', { name: /Username/ });

describe('DataTable', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => { window.matchMedia = originalMatchMedia; });

    it('sorts on the server through a header button with aria-sort', () => {
        const onSort = vi.fn();
        const { rerender } = render(<DataTable columns={columns} data={rows} onSort={onSort} ordering="" />);

        expect(usernameHeader()).toHaveAttribute('aria-sort', 'none');
        expect(screen.getByRole('columnheader', { name: 'Email' })).not.toHaveAttribute('aria-sort');

        fireEvent.click(within(usernameHeader()).getByRole('button'));
        expect(onSort).toHaveBeenLastCalledWith('username');

        rerender(<DataTable columns={columns} data={rows} onSort={onSort} ordering="username" />);
        expect(usernameHeader()).toHaveAttribute('aria-sort', 'ascending');
        fireEvent.click(within(usernameHeader()).getByRole('button'));
        expect(onSort).toHaveBeenLastCalledWith('-username');

        rerender(<DataTable columns={columns} data={rows} onSort={onSort} ordering="-username" />);
        expect(usernameHeader()).toHaveAttribute('aria-sort', 'descending');
        // Rows keep the order the server returned them in.
        expect(screen.getAllByRole('row')[1]).toHaveTextContent('alice');
    });

    it('labels row checkboxes and opens rows through an explicit View button', () => {
        const onSelectionChange = vi.fn();
        const onView = vi.fn();
        render(
            <DataTable
                columns={columns}
                data={rows}
                selectable
                selectedRows={[]}
                onSelectionChange={onSelectionChange}
                onView={onView}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select bob' }));
        expect(onSelectionChange).toHaveBeenCalledWith([2]);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
        expect(onSelectionChange).toHaveBeenLastCalledWith([1, 2]);

        fireEvent.click(screen.getAllByRole('row')[1]);
        expect(onView).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'View alice' }));
        expect(onView).toHaveBeenCalledWith(rows[0]);
    });

    it('renders cards below the sm breakpoint', () => {
        mockMatchMedia(true);
        render(<DataTable columns={columns} data={rows} selectable selectedRows={[1]} onSelectionChange={() => {}} />);

        expect(screen.queryByRole('table')).toBeNull();
        const cards = screen.getAllByTestId('admin-card');
        expect(cards).toHaveLength(2);
        expect(within(cards[0]).getByText('Username')).toBeInTheDocument();
        expect(within(cards[0]).getByText('alice')).toBeInTheDocument();
        expect(within(cards[0]).getByRole('button', { name: 'Edit alice' })).toBeInTheDocument();
        expect(within(cards[0]).getByRole('checkbox', { name: 'Select alice' })).toBeChecked();
    });
});
