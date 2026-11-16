import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
