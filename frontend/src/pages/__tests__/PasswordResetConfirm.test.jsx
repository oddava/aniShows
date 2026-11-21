import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import PasswordResetConfirm from '../PasswordResetConfirm';
import { authApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    authApi: { resetPassword: vi.fn() },
}));

let currentLocation = null;
function LocationSpy() {
    currentLocation = useLocation();
    return null;
}

const renderAt = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <LocationSpy />
            <Routes>
                <Route path="/reset-password" element={<PasswordResetConfirm />} />
                <Route path="/reset-password/:uid/:token" element={<PasswordResetConfirm />} />
                <Route path="/login" element={<div>Login page</div>} />
            </Routes>
        </MemoryRouter>,
    );

const submit = (password) => {
    const fields = document.querySelectorAll('input[type="password"]');
    fireEvent.change(fields[0], { target: { value: password } });
    fireEvent.change(fields[1], { target: { value: password } });
    fireEvent.submit(fields[0].closest('form'));
};

describe('PasswordResetConfirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.resetPassword.mockResolvedValue({ data: { message: 'ok' } });
    });

    it('strips the token from the address bar on load', async () => {
        renderAt('/reset-password/MQ/abc-123');

        await waitFor(() => expect(currentLocation.pathname).toBe('/reset-password'));
        expect(JSON.stringify(currentLocation.pathname + currentLocation.search)).not.toContain('abc-123');
    });

    it('still submits the token from router state and lands on login with a message', async () => {
        renderAt('/reset-password/MQ/abc-123');
        await waitFor(() => expect(currentLocation.pathname).toBe('/reset-password'));

        submit('N3w-Passphrase!');

        await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith('MQ', 'abc-123', 'N3w-Passphrase!'));
        expect(await screen.findByText('Login page')).toBeInTheDocument();
        expect(currentLocation.state.message).toMatch(/password reset successfully/i);
    });

    it('shows an inline error under both empty fields at once', async () => {
        renderAt('/reset-password/MQ/abc-123');
        await waitFor(() => expect(currentLocation.pathname).toBe('/reset-password'));
        const form = document.querySelector('form');
        expect(form).toHaveAttribute('novalidate');

        fireEvent.submit(form);

        expect(await screen.findByText('Enter a new password.')).toBeInTheDocument();
        expect(screen.getByText('Type the password again.')).toBeInTheDocument();
        expect(screen.getByLabelText('New Password')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('aria-invalid', 'true');
        expect(authApi.resetPassword).not.toHaveBeenCalled();
    });

    it('puts a mismatch under the confirmation field', async () => {
        renderAt('/reset-password/MQ/abc-123');
        await waitFor(() => expect(currentLocation.pathname).toBe('/reset-password'));

        const fields = document.querySelectorAll('input[type="password"]');
        fireEvent.change(fields[0], { target: { value: 'N3w-Passphrase!' } });
        fireEvent.change(fields[1], { target: { value: 'different-one' } });
        fireEvent.submit(fields[0].closest('form'));

        expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
        expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('aria-invalid', 'true');
        expect(authApi.resetPassword).not.toHaveBeenCalled();
    });

    it('refuses to submit when opened without a token', async () => {
        renderAt('/reset-password');

        submit('N3w-Passphrase!');

        expect(await screen.findByText(/incomplete/i)).toBeInTheDocument();
        expect(authApi.resetPassword).not.toHaveBeenCalled();
    });
});
