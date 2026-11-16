import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminGenres from '../AdminGenres';

const { getMock, deleteMock, postMock, toastError, toastSuccess, role } = vi.hoisted(() => ({
    getMock: vi.fn(),
    deleteMock: vi.fn(),
    postMock: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    role: { isSuperuser: true, isStaff: true },
}));

vi.mock('../../../api/client', () => ({
    default: {
        get: (...args) => getMock(...args),
        delete: (...args) => deleteMock(...args),
        post: (...args) => postMock(...args),
        put: vi.fn(),
    },
}));
vi.mock('react-hot-toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => role }));

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <AdminGenres />
            </MemoryRouter>
        </QueryClientProvider>,
    );
};

const genre = (id, name) => ({ id, name, slug: name.toLowerCase(), anime_count: 0 });

describe('AdminGenres', () => {
    beforeEach(() => {
        getMock.mockReset();
        deleteMock.mockReset();
        postMock.mockReset();
        toastError.mockReset();
        toastSuccess.mockReset();
        role.isSuperuser = true;
    });
    afterEach(() => vi.restoreAllMocks());

    it('shows the loading state, then the rows', async () => {
        getMock.mockResolvedValue({ data: { results: [genre(1, 'Action')], count: 1 } });
        renderPage();

        expect(screen.getByText('Loading data...')).toBeInTheDocument();
        expect(await screen.findByText('Action')).toBeInTheDocument();
        expect(screen.queryByText('Loading data...')).toBeNull();
        expect(getMock).toHaveBeenCalledWith('/admin/genres/?page=1', expect.anything());
    });

    it('toasts a failed load once and shows an error state, not an empty list', async () => {
        getMock.mockRejectedValue({ response: { status: 500 } });
        renderPage();

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to load genres'));
        expect(await screen.findByText('Couldn’t load genres', {}, { timeout: 5000 })).toBeInTheDocument();
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Loading data...')).toBeNull();
        expect(screen.queryByText('No genres found')).toBeNull();
        expect(screen.getByRole('button', { name: /Retry|Try again/ })).toBeInTheDocument();
    });

    it('confirms in a dialog, then deletes and refetches', async () => {
        getMock
            .mockResolvedValueOnce({ data: { results: [genre(1, 'Action'), genre(2, 'Drama')], count: 2 } })
            .mockResolvedValue({ data: { results: [genre(2, 'Drama')], count: 1 } });
        deleteMock.mockResolvedValue({});
        renderPage();
        await screen.findByText('Action');

        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
        const dialog = await screen.findByRole('alertdialog', { name: 'Delete genre?' });
        expect(deleteMock).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(screen.queryByText('Action')).toBeNull());
        expect(deleteMock).toHaveBeenCalledWith('/admin/genres/1/');
        expect(toastSuccess).toHaveBeenCalledWith('Genre deleted successfully');
        expect(getMock).toHaveBeenCalledTimes(2);
    });

    it('bulk delete runs a dry run first and sends the matched count as confirm', async () => {
        getMock.mockResolvedValue({ data: { results: [genre(1, 'Action'), genre(2, 'Drama')], count: 2 } });
        postMock
            .mockResolvedValueOnce({ data: { dry_run: true, matched: 2, would_delete_by_model: { 'anime.Genre': 2 } } })
            .mockResolvedValueOnce({ data: { message: 'Deleted 2 genres.', matched: 2 } });
        renderPage();
        await screen.findByText('Action');

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

        const dialog = await screen.findByRole('alertdialog', { name: 'Delete 2 genres?' });
        expect(within(dialog).getByText('Genre')).toBeInTheDocument();
        expect(postMock).toHaveBeenCalledWith('/admin/bulk/', expect.objectContaining({
            operation: 'delete', entity_type: 'genre', entity_ids: [1, 2], dry_run: true,
        }));

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Deleted 2 genres.'));
        expect(postMock).toHaveBeenLastCalledWith('/admin/bulk/', expect.objectContaining({
            entity_ids: [1, 2], confirm: '2',
        }));
        expect(postMock.mock.calls[1][1]).not.toHaveProperty('dry_run');
    });

    it('hides write controls from staff', async () => {
        role.isSuperuser = false;
        getMock.mockResolvedValue({ data: { results: [genre(1, 'Action')], count: 1 } });
        renderPage();
        await screen.findByText('Action');

        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Add Genre/ })).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });
});
