import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UNVERIFIED_ACCOUNT_DAYS } from '../../components/auth/formValidation';
import VerificationPending from '../VerificationPending';
import { authApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    authApi: {
        resendVerification: vi.fn(),
    },
}));

const renderAt = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/verification-pending" element={<VerificationPending />} />
                <Route path="/register" element={<div>Register page</div>} />
            </Routes>
        </MemoryRouter>,
    );

describe('VerificationPending', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.resendVerification.mockResolvedValue({ data: { message: 'ok' } });
    });

    it('prefills the address from router state and shows its message', () => {
        renderAt({
            pathname: '/verification-pending',
            state: { email: 'a@b.c', message: 'Please verify within 7 days.' },
        });

        expect(screen.getByPlaceholderText('Enter your email')).toHaveValue('a@b.c');
        expect(screen.getByText('Please verify within 7 days.')).toBeInTheDocument();
    });

    it('falls back to the ?email= query parameter', () => {
        renderAt('/verification-pending?email=q%40b.c');
        expect(screen.getByPlaceholderText('Enter your email')).toHaveValue('q@b.c');
    });

    it('offers a fresh sign-up for a mistyped address, with the real removal window', () => {
        renderAt({ pathname: '/verification-pending', state: { email: 'typo@exmaple.com' } });

        expect(screen.getByRole('heading', { name: 'Wrong address?' })).toBeInTheDocument();
        expect(screen.getByText(new RegExp(`removed automatically after ${UNVERIFIED_ACCOUNT_DAYS} days`))).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Sign up again' })).toHaveAttribute('href', '/register');
    });

    it('shows an inline error instead of sending an empty address', async () => {
        renderAt('/verification-pending');
        const form = document.querySelector('form');
        expect(form).toHaveAttribute('novalidate');

        fireEvent.submit(form);

        expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
        expect(authApi.resendVerification).not.toHaveBeenCalled();
    });

    it('shows a failed resend as an error, not a success', async () => {
        authApi.resendVerification.mockRejectedValueOnce(new Error('offline'));
        renderAt({ pathname: '/verification-pending', state: { email: 'a@b.co' } });

        fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    });

    it('sends the address as a plain string, not a nested object', async () => {
        renderAt({ pathname: '/verification-pending', state: { email: ' a@b.c ' } });

        fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

        await waitFor(() => expect(authApi.resendVerification).toHaveBeenCalledTimes(1));
        expect(authApi.resendVerification).toHaveBeenCalledWith('a@b.c');
        expect(
            await screen.findByText(/a new link has been sent/i),
        ).toBeInTheDocument();
    });
});
