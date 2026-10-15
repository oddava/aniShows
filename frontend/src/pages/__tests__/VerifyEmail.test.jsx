import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VerifyEmail from '../VerifyEmail';
import { authApi } from '../../api/client';

const startSessionMock = vi.fn();

vi.mock('../../api/client', () => ({
    authApi: {
        verifyEmail: vi.fn(),
    },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        startSession: startSessionMock,
    }),
}));

const renderPage = () =>
    render(
        <StrictMode>
            <MemoryRouter initialEntries={['/verify-email/Nw/token123']}>
                <Routes>
                    <Route path="/verify-email/:uid/:token" element={<VerifyEmail />} />
                    <Route path="/browse" element={<div>Browse page</div>} />
                </Routes>
            </MemoryRouter>
        </StrictMode>,
    );

describe('VerifyEmail', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts a session on first verification and sends the token only once', async () => {
        const user = { id: 7, email_verified: true };
        authApi.verifyEmail.mockResolvedValue({ data: { access: 'access-token', user } });

        renderPage();

        expect(await screen.findByText('Email Verified!')).toBeInTheDocument();
        expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
        expect(authApi.verifyEmail).toHaveBeenCalledWith('Nw', 'token123');
        expect(startSessionMock).toHaveBeenCalledWith('access-token', user);
    });

    it('asks an already-verified user to log in instead of starting a session', async () => {
        authApi.verifyEmail.mockResolvedValue({
            data: { message: 'Email already verified', already_verified: true },
        });

        renderPage();

        expect(await screen.findByText('Already Verified')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
        await waitFor(() => expect(authApi.verifyEmail).toHaveBeenCalledTimes(1));
        expect(startSessionMock).not.toHaveBeenCalled();
    });
});
