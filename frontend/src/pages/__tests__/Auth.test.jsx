import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Login, Register } from '../Auth';

const loginMock = vi.fn();
const registerMock = vi.fn();
const googleButtonProps = vi.fn();

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ login: loginMock, register: registerMock, isAuthenticated: false }),
}));
vi.mock('../../components/GoogleLoginButton', () => ({
    default: (props) => {
        googleButtonProps(props);
        return null;
    },
}));
vi.mock('../../components/SEO', () => ({ default: () => null }));

const type = (placeholder, value) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

function Where() {
    const location = useLocation();
    return (
        <div data-testid="where">
            {location.pathname}{location.search}|{location.state?.message ?? ''}
        </div>
    );
}

const renderAuth = (entry, element) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/login" element={element} />
                <Route path="/register" element={element} />
                <Route path="*" element={<Where />} />
            </Routes>
        </MemoryRouter>,
    );

const submitLogin = (container) => {
    type('Enter your username or email', 'me');
    type('Enter your password', 'secret-pass');
    fireEvent.submit(container.querySelector('form'));
};

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

    it('ties labels to inputs and sets phone/password-manager attributes', () => {
        render(<MemoryRouter><Login /></MemoryRouter>);

        const username = screen.getByLabelText('Username or Email');
        expect(username).toHaveAttribute('autocomplete', 'username');
        expect(username).toHaveAttribute('autocapitalize', 'none');
        expect(username).toHaveAttribute('spellcheck', 'false');

        const password = screen.getByLabelText('Password');
        expect(password).toHaveAttribute('autocomplete', 'current-password');
        expect(password).toHaveAttribute('type', 'password');
    });

    it('toggles password visibility with a pressed-state button', () => {
        render(<MemoryRouter><Login /></MemoryRouter>);

        const toggle = screen.getByRole('button', { name: 'Show password' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(toggle);

        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows the message passed in router state', () => {
        renderAuth(
            { pathname: '/login', state: { message: 'Password reset successfully. Please login with your new password.' } },
            <Login />,
        );

        expect(screen.getByText('Password reset successfully. Please login with your new password.')).toBeInTheDocument();
    });

    it('announces a login error', async () => {
        loginMock.mockRejectedValue({ response: { data: { detail: 'Invalid credentials', code: 'auth_failed' } } });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    });

    it('defaults to /browse after login', async () => {
        loginMock.mockResolvedValue({ username: 'me' });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        expect(await screen.findByTestId('where')).toHaveTextContent('/browse');
        expect(googleButtonProps).toHaveBeenLastCalledWith({ returnTo: '/browse' });
    });

    it('honours ?next= and passes it to Google sign-in', async () => {
        loginMock.mockResolvedValue({ username: 'me' });
        const { container } = renderAuth('/login?next=%2Fu%2Fme%3Ftab%3Dlists', <Login />);

        expect(googleButtonProps).toHaveBeenLastCalledWith({ returnTo: '/u/me?tab=lists' });
        submitLogin(container);

        expect(await screen.findByTestId('where')).toHaveTextContent('/u/me?tab=lists');
    });

    it('honours a string state.from', async () => {
        loginMock.mockResolvedValue({ username: 'me' });
        const { container } = renderAuth({ pathname: '/login', state: { from: '/import' } }, <Login />);

        submitLogin(container);

        expect(await screen.findByTestId('where')).toHaveTextContent('/import');
    });

    it.each([
        'https://evil.example/phish',
        '//evil.example/phish',
        '/\\evil.example',
        'javascript:alert(1)',
    ])('ignores the external next=%s', async (next) => {
        loginMock.mockResolvedValue({ username: 'me' });
        const { container } = renderAuth(`/login?next=${encodeURIComponent(next)}`, <Login />);

        expect(googleButtonProps).toHaveBeenLastCalledWith({ returnTo: '/browse' });
        submitLogin(container);

        expect(await screen.findByTestId('where')).toHaveTextContent(/^\/browse\|/);
    });

    it('still sends staff to /admin when no return path was asked for', async () => {
        loginMock.mockResolvedValue({ username: 'boss', is_staff: true });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        expect(await screen.findByTestId('where')).toHaveTextContent('/admin');
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

    it('ties labels to inputs and sets autocomplete hints', () => {
        render(<MemoryRouter><Register /></MemoryRouter>);

        expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
        const email = screen.getByLabelText('Email Address');
        expect(email).toHaveAttribute('autocomplete', 'email');
        expect(email).toHaveAttribute('inputmode', 'email');
        expect(email).toHaveAttribute('autocapitalize', 'none');
        expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
        expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('autocomplete', 'new-password');
    });

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

        expect(await screen.findByRole('alert')).toHaveTextContent('This password is too common.');
        // Inline on the password field, not only in a generic banner.
        const passwordInput = screen.getByPlaceholderText('Create a password');
        expect(passwordInput.className).toContain('!border-red-500');
        expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('rejects an all-numeric password before calling the server', async () => {
        const { container } = render(<MemoryRouter><Register /></MemoryRouter>);

        fill('12345678');
        fireEvent.submit(container.querySelector('form'));

        expect(await screen.findByText('Password cannot be entirely numeric.')).toBeInTheDocument();
        expect(registerMock).not.toHaveBeenCalled();
    });

    it('goes to verification-pending when verification is required', async () => {
        registerMock.mockResolvedValue({ message: 'Registration successful. Please check your email to verify your account.' });
        const { container } = renderAuth('/register', <Register />);

        fill('long-enough-pass');
        fireEvent.submit(container.querySelector('form'));

        expect(await screen.findByTestId('where')).toHaveTextContent('/verification-pending|');
        expect(screen.getByTestId('where')).toHaveTextContent('deleted after 7 days');
        expect(loginMock).not.toHaveBeenCalled();
    });

    it('signs straight in when verification is optional', async () => {
        registerMock.mockResolvedValue({ message: 'Registration successful. Email verification is currently optional.' });
        loginMock.mockResolvedValue({ username: 'newbie' });
        const { container } = renderAuth('/register', <Register />);

        fill('long-enough-pass');
        fireEvent.submit(container.querySelector('form'));

        await waitFor(() => expect(loginMock).toHaveBeenCalledWith('newbie', 'long-enough-pass'));
        expect(await screen.findByTestId('where')).toHaveTextContent(/^\/browse\|$/);
        expect(registerMock).toHaveBeenCalledWith('newbie', 'n@example.com', 'long-enough-pass');
    });
});
