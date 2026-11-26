import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { ConfirmDialog, DataTable, Dialog, Drawer, Menu, Pagination } from '..';
import { useListParams, useOpenParam, useSelection } from '../../hooks';
import { errorMessage } from '../../api';

const ROWS = [
    { id: 1, name: 'Mika', reviews: 3 },
    { id: 2, name: 'Sora', reviews: 0 },
];

const COLUMNS = [
    { key: 'name', header: 'Name', primary: true, sortKey: 'name', sortFirst: 'asc', cell: (row) => <a href={`#${row.id}`}>{row.name}</a> },
    { key: 'reviews', header: 'Reviews', align: 'right', sortKey: 'reviews', cell: (row) => row.reviews },
];

describe('DataTable', () => {
    it('renders rows and marks the active sort on its header', () => {
        render(<DataTable columns={COLUMNS} rows={ROWS} sort={{ value: '-reviews', onChange: vi.fn() }} />);
        expect(screen.getByRole('link', { name: 'Mika' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Reviews/ })).toHaveAttribute('aria-sort', 'descending');
        expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'none');
    });

    it('cycles sort direction, starting with the column’s first direction', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<DataTable columns={COLUMNS} rows={ROWS} sort={{ value: '', onChange }} />);
        await userEvent.click(screen.getByRole('button', { name: /Name/ }));
        expect(onChange).toHaveBeenLastCalledWith('name');
        rerender(<DataTable columns={COLUMNS} rows={ROWS} sort={{ value: 'name', onChange }} />);
        await userEvent.click(screen.getByRole('button', { name: /Name/ }));
        expect(onChange).toHaveBeenLastCalledWith('-name');
    });

    it('selects all rows on the page and shows the mixed state', async () => {
        function Harness() {
            const selection = useSelection();
            return <DataTable columns={COLUMNS} rows={ROWS} selection={selection} />;
        }
        render(<Harness />);
        const [first] = screen.getAllByRole('checkbox', { name: 'Select row' });
        await userEvent.click(first);
        const all = screen.getByRole('checkbox', { name: 'Select all on this page' });
        expect(all.indeterminate).toBe(true);
        await userEvent.click(all);
        screen.getAllByRole('checkbox', { name: 'Select row' }).forEach((box) => expect(box).toBeChecked());
    });

    it('row clicks skip links and buttons inside the row', async () => {
        const onRowClick = vi.fn();
        render(<DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} />);
        await userEvent.click(screen.getByRole('link', { name: 'Mika' }));
        expect(onRowClick).not.toHaveBeenCalled();
        await userEvent.click(screen.getAllByRole('cell', { name: '3' })[0]);
        expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
    });

    it('shows the empty state, and an error with a retry when nothing loaded', async () => {
        const { rerender } = render(<DataTable columns={COLUMNS} rows={[]} />);
        expect(screen.getByText('Nothing here')).toBeInTheDocument();
        const onRetry = vi.fn();
        rerender(<DataTable columns={COLUMNS} rows={[]} error={{ response: { status: 500, data: { detail: 'Database is down.' } } }} onRetry={onRetry} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Database is down.');
        await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
        expect(onRetry).toHaveBeenCalled();
    });

    it('explains a 403 instead of offering a retry', () => {
        render(<DataTable columns={COLUMNS} rows={[]} error={{ response: { status: 403, data: {} } }} onRetry={vi.fn()} />);
        expect(screen.getByText('Superusers only')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
    });
});

describe('Pagination', () => {
    it('shows the range and disables the ends', () => {
        const onChange = vi.fn();
        render(<Pagination page={1} totalPages={3} count={45} pageSize={20} onChange={onChange} />);
        expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1–20 of 45');
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(onChange).toHaveBeenCalledWith(2);
    });
});

describe('ConfirmDialog', () => {
    it('keeps confirm disabled until the reason is long enough', async () => {
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="Suspend Mika?" confirmLabel="Suspend" tone="danger" reason={{ required: true }}>
                They are signed out everywhere.
            </ConfirmDialog>,
        );
        const dialog = screen.getByRole('dialog', { name: 'Suspend Mika?' });
        const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
        expect(confirm).toBeDisabled();
        await userEvent.type(within(dialog).getByRole('textbox'), '  spam  ');
        expect(confirm).toBeEnabled();
        await userEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledWith({ reason: 'spam' });
    });

    it('requires the confirmation word when asked', async () => {
        const onConfirm = vi.fn();
        render(<ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="Delete Mika?" confirmLabel="Delete" confirmText="mika" />);
        const confirm = screen.getByRole('button', { name: 'Delete' });
        await userEvent.type(screen.getByRole('textbox'), 'mik');
        expect(confirm).toBeDisabled();
        await userEvent.type(screen.getByRole('textbox'), 'a');
        await userEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
        const onClose = vi.fn();
        render(<ConfirmDialog open onClose={onClose} onConfirm={vi.fn()} title="Sure?" />);
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalled();
    });
});

describe('Menu', () => {
    it('opens, moves with arrows, skips disabled items and runs the choice', async () => {
        const edit = vi.fn();
        const remove = vi.fn();
        render(
            <MemoryRouter>
                <Menu label="Actions for Mika" items={[
                    { label: 'Edit', onSelect: edit },
                    { label: 'Locked', disabled: true, onSelect: vi.fn() },
                    { label: 'Hidden', hidden: true, onSelect: vi.fn() },
                    'divider',
                    { label: 'Delete', tone: 'danger', onSelect: remove },
                ]} />
            </MemoryRouter>,
        );
        const button = screen.getByRole('button', { name: 'Actions for Mika' });
        await userEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByRole('menuitem', { name: 'Hidden' })).not.toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(remove).toHaveBeenCalled();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(button).toHaveFocus();
    });

    it('renders nothing when every item is hidden', () => {
        render(<MemoryRouter><Menu items={[{ label: 'Edit', hidden: true }]} /></MemoryRouter>);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

function routerWrapper(initial) {
    return function Wrapper({ children }) {
        return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
    };
}

describe('useListParams', () => {
    it('reads filters from the URL and builds API params', () => {
        const { result } = renderHook(() => useListParams({ ordering: '-date_joined', is_active: '' }), {
            wrapper: routerWrapper('/admin/users?is_active=false&page=2&q=mika'),
        });
        expect(result.current.values).toEqual({ ordering: '-date_joined', is_active: 'false' });
        expect(result.current.page).toBe(2);
        expect(result.current.apiParams).toEqual({ ordering: '-date_joined', is_active: 'false', search: 'mika', page: 2, page_size: 20 });
        expect(result.current.isFiltered).toBe(true);
    });

    it('goes back to page 1 on a filter change and keeps defaults out of the URL', () => {
        let location;
        const { result } = renderHook(() => {
            location = useLocation();
            return useListParams({ ordering: '-date_joined', is_active: '' });
        }, { wrapper: routerWrapper('/admin/users?page=3') });
        act(() => result.current.set({ is_active: 'true' }));
        expect(location.search).toBe('?is_active=true');
        act(() => result.current.set({ ordering: '-date_joined' }));
        expect(location.search).toBe('?is_active=true');
    });

    it('reset clears its own params but keeps the page’s tab and drawer', () => {
        let location;
        const { result } = renderHook(() => {
            location = useLocation();
            return useListParams({ status: '' });
        }, { wrapper: routerWrapper('/admin/forums?tab=threads&open=4&status=removed&q=spoiler&page=2') });
        act(() => result.current.reset());
        expect(new URLSearchParams(location.search).toString()).toBe('tab=threads&open=4');
    });
});

describe('useOpenParam', () => {
    it('opens and closes a record through ?open=', () => {
        let location;
        const { result } = renderHook(() => {
            location = useLocation();
            return useOpenParam();
        }, { wrapper: routerWrapper('/admin/reviews?rating=3') });
        act(() => result.current[1](12));
        expect(result.current[0]).toBe('12');
        expect(location.search).toBe('?rating=3&open=12');
        act(() => result.current[1](null));
        expect(location.search).toBe('?rating=3');
    });
});

describe('errorMessage', () => {
    it('prefers detail, then field errors, then the fallback', () => {
        expect(errorMessage({ response: { status: 400, data: { detail: 'Nope.' } } })).toBe('Nope.');
        expect(errorMessage({ response: { status: 400, data: { name: ['This field is required.'] } } })).toBe('Name: This field is required.');
        expect(errorMessage({ response: { status: 400, data: { errors: { 'users.minUsernameLength': 'Must be >= 1.' } } } })).toBe('users.minUsernameLength: Must be >= 1.');
        expect(errorMessage({ response: { status: 500, data: '<html>' } }, 'Fallback.')).toBe('Fallback.');
        expect(errorMessage({ request: {} })).toMatch(/Could not reach the server/);
    });
});

describe('fieldErrors', () => {
    it('reads the API envelope and DRF bare errors alike', async () => {
        const { fieldErrors } = await import('../../api');
        const envelope = { response: { status: 400, data: { code: 'validation_error', detail: 'Enter a valid URL.', errors: { link_url: ['Enter a valid URL.'], title: 'Too long.' } } } };
        expect(fieldErrors(envelope)).toEqual({ link_url: 'Enter a valid URL.', title: 'Too long.' });
        expect(fieldErrors({ response: { status: 400, data: { name: ['Required.'], detail: 'x' } } })).toEqual({ name: 'Required.' });
        expect(fieldErrors({ response: { status: 500, data: '<html>' } })).toEqual({});
    });
});

describe('overlay focus', () => {
    function Harness({ nested = false, disabledLast = false }) {
        const [open, setOpen] = React.useState(false);
        const [inner, setInner] = React.useState(false);
        return (
            <>
                <button type="button" onClick={() => setOpen(true)}>Open</button>
                <a href="#behind">Behind</a>
                <Dialog
                    open={open}
                    onClose={() => setOpen(false)}
                    title="Outer"
                    footer={<button type="button" disabled={disabledLast}>Last</button>}
                >
                    <button type="button" onClick={() => setInner(true)}>Open inner</button>
                </Dialog>
                {nested && (
                    <ConfirmDialog open={inner} onClose={() => setInner(false)} onConfirm={() => {}} title="Inner" />
                )}
            </>
        );
    }

    it('traps a dialog that opens after the page mounted, and gives focus back on close', async () => {
        render(<Harness disabledLast />);
        const opener = screen.getByRole('button', { name: 'Open' });
        await userEvent.click(opener);
        const dialog = await screen.findByRole('dialog', { name: 'Outer' });
        expect(dialog).toHaveFocus();
        for (let step = 0; step < 6; step += 1) {
            await userEvent.tab();
            expect(dialog.contains(document.activeElement)).toBe(true);
        }
        await userEvent.keyboard('{Escape}');
        await waitForGone('Outer');
        expect(opener).toHaveFocus();
    });

    it('closes only the topmost dialog on Escape', async () => {
        render(<Harness nested />);
        await userEvent.click(screen.getByRole('button', { name: 'Open' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Open inner' }));
        await screen.findByRole('dialog', { name: 'Inner' });
        await userEvent.keyboard('{Escape}');
        await waitForGone('Inner');
        expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open inner' })).toHaveFocus();
    });

    async function waitForGone(name) {
        await vi.waitFor(() => expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument());
    }
});

describe('overlay focus, round 2', () => {
    function DrawerWithConfirm() {
        const [drawer, setDrawer] = React.useState(false);
        const [confirm, setConfirm] = React.useState(false);
        return (
            <MemoryRouter>
                <button type="button" onClick={() => setDrawer(true)}>Open review</button>
                <Drawer open={drawer} onClose={() => setDrawer(false)} title="Review">
                    <button type="button" onClick={() => setConfirm(true)}>Remove review</button>
                    <Menu label="More actions" items={[{ label: 'Pin', onSelect: () => {} }]} />
                    <button type="button">Last in drawer</button>
                </Drawer>
                <ConfirmDialog
                    open={confirm}
                    onClose={() => setConfirm(false)}
                    onConfirm={() => {}}
                    title="Remove this review?"
                    reason={{ required: true }}
                />
            </MemoryRouter>
        );
    }

    it('gives focus back to the opener even when the dialog autofocuses a field', async () => {
        render(<DrawerWithConfirm />);
        await userEvent.click(screen.getByRole('button', { name: 'Open review' }));
        const remove = await screen.findByRole('button', { name: 'Remove review' });
        await userEvent.click(remove);
        const dialog = await screen.findByRole('dialog', { name: 'Remove this review?' });
        expect(within(dialog).getByRole('textbox')).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove this review?' })).not.toBeInTheDocument());
        expect(remove).toHaveFocus();
        expect(screen.getByRole('dialog', { name: 'Review' })).toBeInTheDocument();
    });

    it('Tab out of a menu inside a drawer closes the menu and stays in the drawer', async () => {
        render(<DrawerWithConfirm />);
        await userEvent.click(screen.getByRole('button', { name: 'Open review' }));
        const drawer = await screen.findByRole('dialog', { name: 'Review' });
        await userEvent.click(within(drawer).getByRole('button', { name: 'More actions' }));
        expect(screen.getByRole('menuitem', { name: 'Pin' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(within(drawer).getByRole('button', { name: 'More actions' })).toHaveFocus();
        await userEvent.tab();
        expect(drawer.contains(document.activeElement)).toBe(true);
    });
});
