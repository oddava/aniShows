import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ConfirmEmailChange from '../ConfirmEmailChange';
import { authApi } from '../../api/client';

const logoutMock = vi.fn();

vi.mock('../../api/client', () => ({
    authApi: {
        confirmEmailChange: vi.fn(),
    },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        logout: logoutMock,
    }),
}));

let currentPath = '';
function PathSpy() {
    currentPath = useLocation().pathname;
    return null;
}

const renderAt = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <PathSpy />
            <Routes>
                <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
                <Route path="/confirm-email-change/:uid/:token" element={<ConfirmEmailChange />} />
                <Route
                    path="/confirm-email-change/:uid/:token/:new_email"
                    element={<ConfirmEmailChange />}
                />
            </Routes>
        </MemoryRouter>,
    );

describe('ConfirmEmailChange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('signs out locally after a successful email confirmation', async () => {
        authApi.confirmEmailChange.mockResolvedValue({ data: { message: 'ok' } });
        logoutMock.mockResolvedValue(undefined);

        renderAt('/confirm-email-change/Nw/token123/anVzdGNvZGVyckBnbWFpbC5jb20');

        await waitFor(() => {
            expect(authApi.confirmEmailChange).toHaveBeenCalledWith(
                'Nw',
                'token123',
                'anVzdGNvZGVyckBnbWFpbC5jb20',
            );
        });

        await waitFor(() => {
            expect(logoutMock).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('Email Updated!')).toBeInTheDocument();
    });

    it('confirms a {uid, token} link and strips it from the address bar', async () => {
        authApi.confirmEmailChange.mockResolvedValue({ data: { message: 'ok' } });
        logoutMock.mockResolvedValue(undefined);

        renderAt('/confirm-email-change/Nw/token123');

        await waitFor(() => {
            expect(authApi.confirmEmailChange).toHaveBeenCalledWith('Nw', 'token123', undefined);
        });
        expect(authApi.confirmEmailChange).toHaveBeenCalledTimes(1);
        expect(currentPath).toBe('/confirm-email-change');
        expect(await screen.findByText(/sign in again/i)).toBeInTheDocument();
    });
});
