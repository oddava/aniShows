import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountTab from '../AccountTab';
import useAccountSettings, { ACCOUNT_SETTINGS_PATH } from '../useAccountSettings';
import { authApi, setAccessToken } from '../../../api/client';
import { startGoogleSignIn } from '../../auth/googleSignIn';

vi.mock('../../../api/client', () => ({
    authApi: {
        changePassword: vi.fn(),
        changeEmail: vi.fn(),
        deleteAccount: vi.fn(),
        resendVerification: vi.fn(),
        resendEmailChange: vi.fn(),
        cancelEmailChange: vi.fn(),
        getSessions: vi.fn(),
        revokeOtherSessions: vi.fn(),
    },
    clearSession: vi.fn(),
    setAccessToken: vi.fn(),
}));

const refreshProfileMock = vi.fn(() => Promise.resolve({}));
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ refreshProfile: refreshProfileMock }),
}));

vi.mock('../../auth/googleSignIn', () => ({
    startGoogleSignIn: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
    default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const googleUser = { id: 1, username: 'googly', email: 'g@example.com', email_verified: true, has_password: false };
const reauthError = {
    response: { status: 403, data: { detail: "Please confirm it's you.", code: 'reauth_required' } },
};

describe('useAccountSettings re-auth', () => {
    beforeEach(() => vi.clearAllMocks());

    it('turns a reauth_required error into a "Confirm it\'s you" prompt', async () => {
        authApi.changeEmail.mockRejectedValue(reauthError);
        const { result } = renderHook(() => useAccountSettings({ user: googleUser, logout: vi.fn() }));

        act(() => result.current.setChangeEmail('new@example.com'));
        await act(() => result.current.handleChangeEmail());

        expect(result.current.reauthRequired).toBe(true);
        expect(result.current.accountError).toBe('');

        act(() => result.current.handleReauth());
        expect(startGoogleSignIn).toHaveBeenCalledWith({
            returnTo: ACCOUNT_SETTINGS_PATH,
            prompt: 'select_account',
        });
    });

    it('keeps the access token returned by change-password', async () => {
        authApi.changePassword.mockResolvedValue({ data: { message: 'ok', access: 'fresh-access' } });
        const { result } = renderHook(() => useAccountSettings({ user: googleUser, logout: vi.fn() }));

        act(() => {
            result.current.setNewPassword('N3w-Passphrase!');
            result.current.setConfirmPassword('N3w-Passphrase!');
        });
        await act(() => result.current.handleChangePassword());

        expect(setAccessToken).toHaveBeenCalledWith('fresh-access');
        expect(result.current.accountSuccess).toMatch(/password changed/i);
    });
});

const baseAccount = {
    changeEmail: '',
    setChangeEmail: vi.fn(),
    handleResendEmailChange: vi.fn(),
    handleCancelEmailChange: vi.fn(),
};

const renderTab = (props = {}) =>
    render(
        <MemoryRouter>
            <AccountTab
                user={googleUser}
                account={baseAccount}
                isPrivate={false}
                handlePrivacyToggle={vi.fn()}
                {...props}
            />
        </MemoryRouter>,
    );

describe('AccountTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.getSessions.mockResolvedValue({ data: { active: 1, current_since: null } });
    });

    it('shows a pending email change with Resend and Cancel', () => {
        renderTab({ user: { ...googleUser, pending_email: 'next@example.com' } });

        expect(screen.getByText('next@example.com')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /resend link/i }));
        fireEvent.click(screen.getByRole('button', { name: /cancel change/i }));
        expect(baseAccount.handleResendEmailChange).toHaveBeenCalled();
        expect(baseAccount.handleCancelEmailChange).toHaveBeenCalled();
    });

    it('hides the pending card when nothing is pending', () => {
        renderTab({ user: { ...googleUser, pending_email: null } });
        expect(screen.queryByText(/waiting for confirmation/i)).not.toBeInTheDocument();
    });

    it('exposes the privacy toggle as a labelled switch', () => {
        const handlePrivacyToggle = vi.fn();
        renderTab({ isPrivate: true, handlePrivacyToggle });

        const toggle = screen.getByRole('switch', { name: 'Private Profile' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(toggle).toHaveAccessibleDescription(/reviews and forum posts stay visible/i);
        fireEvent.click(toggle);
        expect(handlePrivacyToggle).toHaveBeenCalled();
    });

    it('counts devices and signs out the others', async () => {
        authApi.getSessions.mockResolvedValue({ data: { active: 3, current_since: null } });
        authApi.revokeOtherSessions.mockResolvedValue({ data: { revoked: 2, active: 1 } });
        renderTab();

        expect(await screen.findByText(/signed in on 3 devices/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /sign out everywhere else/i }));

        expect(await screen.findByText('Signed out 2 other devices.')).toBeInTheDocument();
        expect(screen.getByText(/this device only/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /sign out everywhere else/i })).not.toBeInTheDocument();
    });

    it('renders the re-auth prompt with a Google button', () => {
        const handleReauth = vi.fn();
        const account = { ...baseAccount, reauthRequired: true, handleReauth };
        render(
            <MemoryRouter>
                <AccountTab user={googleUser} account={account} isPrivate={false} handlePrivacyToggle={vi.fn()} />
            </MemoryRouter>,
        );

        expect(screen.getByRole('alert')).toHaveTextContent("Confirm it's you");
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
        expect(handleReauth).toHaveBeenCalled();
    });
});

describe('useAccountSettings pending email', () => {
    beforeEach(() => vi.clearAllMocks());

    it('cancels and resends through the API and refreshes the profile', async () => {
        authApi.cancelEmailChange.mockResolvedValue({ data: { pending_email: null } });
        authApi.resendEmailChange.mockResolvedValue({ data: { pending_email: 'n@example.com' } });
        const { result } = renderHook(() => useAccountSettings({ user: googleUser, logout: vi.fn() }));

        await act(() => result.current.handleResendEmailChange());
        expect(result.current.accountSuccess).toMatch(/sent again/i);
        await act(() => result.current.handleCancelEmailChange());
        expect(result.current.accountSuccess).toMatch(/cancelled/i);

        expect(authApi.resendEmailChange).toHaveBeenCalledTimes(1);
        expect(authApi.cancelEmailChange).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(refreshProfileMock).toHaveBeenCalledTimes(2));
    });
});
