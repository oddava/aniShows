import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GoogleCallback from '../GoogleCallback';
import { authApi } from '../../api/client';

const startSessionMock = vi.fn();

vi.mock('../../api/client', () => ({
    authApi: { googleLogin: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ startSession: startSessionMock }),
}));

vi.mock('../../utils/logger', () => ({
    default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const renderAt = (query) =>
    render(
        <MemoryRouter initialEntries={[`/auth/google/callback${query}`]}>
            <Routes>
                <Route path="/auth/google/callback" element={<GoogleCallback />} />
                <Route path="/browse" element={<div>Browse page</div>} />
                <Route path="/settings" element={<div>Settings page</div>} />
                <Route path="/login" element={<div>Login page</div>} />
            </Routes>
        </MemoryRouter>,
    );

describe('GoogleCallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        authApi.googleLogin.mockResolvedValue({ data: { access: 'access-token' } });
        startSessionMock.mockResolvedValue({ id: 1 });
    });

    it('rejects a state that does not match this tab', async () => {
        sessionStorage.setItem('google_oauth_state', 'expected');
        renderAt('?code=abc&state=forged');

        expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
        expect(authApi.googleLogin).not.toHaveBeenCalled();
        expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    });

    it('explains a cancelled consent screen without redirecting on a timer', async () => {
        sessionStorage.setItem('google_oauth_state', 's1');
        renderAt('?error=access_denied&state=s1');

        expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled/i);
        expect(screen.queryByText('Login page')).not.toBeInTheDocument();
    });

    it('signs in and lands on /browse by default', async () => {
        sessionStorage.setItem('google_oauth_state', 's1');
        renderAt('?code=abc&state=s1');

        expect(await screen.findByText('Browse page')).toBeInTheDocument();
        expect(startSessionMock).toHaveBeenCalledWith('access-token');
    });

    it('returns to the stored return_to after a re-auth round trip', async () => {
        sessionStorage.setItem('google_oauth_state', 's1');
        sessionStorage.setItem('google_oauth_return_to', '/settings?tab=account');
        renderAt('?code=abc&state=s1');

        expect(await screen.findByText('Settings page')).toBeInTheDocument();
        expect(sessionStorage.getItem('google_oauth_return_to')).toBeNull();
    });

    it('ignores an off-site return_to', async () => {
        sessionStorage.setItem('google_oauth_state', 's1');
        sessionStorage.setItem('google_oauth_return_to', '//evil.example/x');
        renderAt('?code=abc&state=s1');

        expect(await screen.findByText('Browse page')).toBeInTheDocument();
    });

    it('gives an honest message when the email already has a password account', async () => {
        sessionStorage.setItem('google_oauth_state', 's1');
        authApi.googleLogin.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    detail: 'User is already registered with this e-mail address.',
                    code: 'validation_error',
                },
            },
        });
        renderAt('?code=abc&state=s1');

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(/sign in with your email and password/i),
        );
    });
});
