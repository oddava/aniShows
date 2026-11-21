import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PasswordReset from '../PasswordReset';
import { authApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    authApi: { requestPasswordReset: vi.fn() },
}));

const renderPage = () => render(<MemoryRouter><PasswordReset /></MemoryRouter>);

describe('PasswordReset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.requestPasswordReset.mockResolvedValue({ data: { message: 'ok' } });
    });

    it('shows an inline error on an empty submit instead of the browser tooltip', async () => {
        renderPage();
        const form = document.querySelector('form');
        expect(form).toHaveAttribute('novalidate');

        fireEvent.submit(form);

        expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email Address')).toHaveAttribute('aria-invalid', 'true');
        expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
    });

    it('flags a malformed address', async () => {
        renderPage();
        fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'me@home' } });
        fireEvent.submit(document.querySelector('form'));

        expect(await screen.findByText('Enter a valid email address, like name@example.com.')).toBeInTheDocument();
        expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
    });

    it('sends a valid address and shows the neutral confirmation', async () => {
        renderPage();
        fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: ' me@example.com ' } });
        fireEvent.submit(document.querySelector('form'));

        await waitFor(() => expect(authApi.requestPasswordReset).toHaveBeenCalledWith('me@example.com'));
        expect(await screen.findByText(/if an account exists with this email/i)).toBeInTheDocument();
    });
});
