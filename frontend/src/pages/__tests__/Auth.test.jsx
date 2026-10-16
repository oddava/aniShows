import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Login, Register } from '../Auth';

const loginMock = vi.fn();
const registerMock = vi.fn();

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ login: loginMock, register: registerMock, isAuthenticated: false }),
}));
vi.mock('../../components/GoogleLoginButton', () => ({ default: () => null }));
vi.mock('../../components/SEO', () => ({ default: () => null }));

const type = (placeholder, value) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

describe('Login', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends the password exactly as typed', async () => {
        loginMock.mockResolvedValue({ username: 'me' });
        const { container } = render(<MemoryRouter><Login /></MemoryRouter>);

        type('Enter your username or email', '  me  ');
        type('Enter your password', ' spaced pass ');
        fireEvent.submit(container.querySelector('form'));

        await waitFor(() => expect(loginMock).toHaveBeenCalledWith('me', ' spaced pass '));
    });
});

describe('Register', () => {
    beforeEach(() => vi.clearAllMocks());

    const fill = (password) => {
        type('Choose a username', 'newbie');
        type('Enter your email', 'n@example.com');
        type('Create a password', password);
        type('Confirm your password', password);
    };

    it('shows server field errors next to their fields', async () => {
        registerMock.mockRejectedValue({
            response: {
                data: {
                    detail: 'This password is too common.',
                    code: 'validation_error',
                    errors: { password: ['This password is too common.'] },
                },
            },
        });
        const { container } = render(<MemoryRouter><Register /></MemoryRouter>);

        fill('password123');
        fireEvent.submit(container.querySelector('form'));

        expect(await screen.findByText('This password is too common.')).toBeInTheDocument();
        // Inline on the password field, not only in a generic banner.
        expect(screen.getByPlaceholderText('Create a password').className).toContain('!border-red-500');
    });

    it('rejects an all-numeric password before calling the server', async () => {
        const { container } = render(<MemoryRouter><Register /></MemoryRouter>);

        fill('12345678');
        fireEvent.submit(container.querySelector('form'));

        expect(await screen.findByText('Password cannot be entirely numeric.')).toBeInTheDocument();
        expect(registerMock).not.toHaveBeenCalled();
    });
});
