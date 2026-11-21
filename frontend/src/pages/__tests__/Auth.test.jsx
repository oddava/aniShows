import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    it('announces a login error that is not about credentials as the server worded it', async () => {
        loginMock.mockRejectedValue({ response: { status: 403, data: { detail: 'Sign-in is paused.', code: 'forbidden' } } });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Sign-in is paused.');
        expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
    });

    it('turns the SimpleJWT credentials error into a plain line with a reset link, inside the form', async () => {
        loginMock.mockRejectedValue({
            response: {
                status: 401,
                data: { detail: 'No active account found with the given credentials', code: 'no_active_account' },
            },
        });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Wrong username or password.');
        expect(alert).not.toHaveTextContent(/no active account/i);
        expect(within(alert).getByRole('link', { name: 'Reset your password' })).toHaveAttribute('href', '/forgot-password');
        expect(container.querySelector('form')).toContainElement(alert);
    });

    it('maps the same wording without a status code too', async () => {
        loginMock.mockRejectedValue({ response: { data: { detail: 'Invalid credentials', code: 'auth_failed' } } });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
    });

    it('says how long to wait when sign-in is throttled', async () => {
        loginMock.mockRejectedValue({
            response: {
                status: 429,
                headers: { 'retry-after': '42' },
                data: { detail: 'Request was throttled. Expected available in 42 seconds.', code: 'throttled' },
            },
        });
        const { container } = renderAuth('/login', <Login />);

        submitLogin(container);

        expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts. Try again in 42 seconds.');
    });

    it('shows an inline error under every empty field at once, without the browser tooltip', async () => {
        const { container } = renderAuth('/login', <Login />);
        const form = container.querySelector('form');
        expect(form).toHaveAttribute('novalidate');

        fireEvent.submit(form);

        expect(await screen.findByText('Enter your username or email.')).toBeInTheDocument();
        expect(screen.getByText('Enter your password.')).toBeInTheDocument();
        expect(screen.getByLabelText('Username or Email')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Username or Email')).toHaveFocus();
        expect(loginMock).not.toHaveBeenCalled();
    });

    it('clears a field error once that field is edited', async () => {
        const { container } = renderAuth('/login', <Login />);
        fireEvent.submit(container.querySelector('form'));
        expect(await screen.findByText('Enter your password.')).toBeInTheDocument();

        type('Enter your password', 'x');

        expect(screen.queryByText('Enter your password.')).not.toBeInTheDocument();
        expect(screen.getByText('Enter your username or email.')).toBeInTheDocument();
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

    it('shows an inline error under every empty field at once', async () => {
        const { container } = render(<MemoryRouter><Register /></MemoryRouter>);
        const form = container.querySelector('form');
        expect(form).toHaveAttribute('novalidate');

        fireEvent.submit(form);

        expect(await screen.findByText('Choose a username.')).toBeInTheDocument();
        expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
        expect(screen.getByText('Create a password.')).toBeInTheDocument();
        expect(screen.getByText('Type the password again.')).toBeInTheDocument();
        for (const label of ['Username', 'Email Address', 'Password', 'Confirm Password']) {
            expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
        }
        expect(screen.getByLabelText('Username')).toHaveFocus();
        expect(registerMock).not.toHaveBeenCalled();
    });

    it('flags a malformed email and a mismatched confirmation together', async () => {
        const { container } = render(<MemoryRouter><Register /></MemoryRouter>);

        type('Choose a username', 'newbie');
        type('Enter your email', 'not-an-email');
        type('Create a password', 'long-enough-pass');
        type('Confirm your password', 'something-else');
        fireEvent.submit(container.querySelector('form'));

        expect(await screen.findByText('Enter a valid email address, like name@example.com.')).toBeInTheDocument();
        expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email Address')).toHaveFocus();
        expect(registerMock).not.toHaveBeenCalled();
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
