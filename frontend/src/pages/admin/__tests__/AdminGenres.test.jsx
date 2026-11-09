import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminGenres from '../AdminGenres';

const { getMock, deleteMock, toastError, toastSuccess } = vi.hoisted(() => ({
    getMock: vi.fn(),
    deleteMock: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));

vi.mock('../../../api/client', () => ({
    default: {
        get: (...args) => getMock(...args),
        delete: (...args) => deleteMock(...args),
        post: vi.fn(),
        put: vi.fn(),
    },
}));
vi.mock('react-hot-toast', () => ({ toast: { error: toastError, success: toastSuccess } }));

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
        toastError.mockReset();
        toastSuccess.mockReset();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
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

    it('toasts a failed load once and leaves the loading state', async () => {
        getMock.mockRejectedValue({ response: { status: 500 } });
        renderPage();

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to load genres'));
        await waitFor(() => expect(screen.queryByText('Loading data...')).toBeNull());
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(screen.getByText('No genres found')).toBeInTheDocument();
    });

    it('refetches the list after a delete', async () => {
        getMock
            .mockResolvedValueOnce({ data: { results: [genre(1, 'Action'), genre(2, 'Drama')], count: 2 } })
            .mockResolvedValue({ data: { results: [genre(2, 'Drama')], count: 1 } });
        deleteMock.mockResolvedValue({});
        renderPage();
        await screen.findByText('Action');

        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

        await waitFor(() => expect(screen.queryByText('Action')).toBeNull());
        expect(deleteMock).toHaveBeenCalledWith('/admin/genres/1/');
        expect(toastSuccess).toHaveBeenCalledWith('Genre deleted successfully');
        expect(getMock).toHaveBeenCalledTimes(2);
    });
});
