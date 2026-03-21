import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfirmEmailChange from '../ConfirmEmailChange';
import { authApi } from '../../api/client';

const refreshProfileMock = vi.fn();

vi.mock('../../api/client', () => ({
    authApi: {
        confirmEmailChange: vi.fn(),
    },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        refreshProfile: refreshProfileMock,
    }),
}));

describe('ConfirmEmailChange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes auth profile after successful email confirmation', async () => {
        authApi.confirmEmailChange.mockResolvedValue({ data: { message: 'ok' } });
        refreshProfileMock.mockResolvedValue({});

        render(
            <MemoryRouter initialEntries={['/confirm-email-change/Nw/token123/anVzdGNvZGVyckBnbWFpbC5jb20']}>
                <Routes>
                    <Route
                        path="/confirm-email-change/:uid/:token/:new_email"
                        element={<ConfirmEmailChange />}
                    />
                </Routes>
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(authApi.confirmEmailChange).toHaveBeenCalledWith(
                'Nw',
                'token123',
                'anVzdGNvZGVyckBnbWFpbC5jb20',
            );
        });

        await waitFor(() => {
            expect(refreshProfileMock).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('Email Updated!')).toBeInTheDocument();
    });
});
