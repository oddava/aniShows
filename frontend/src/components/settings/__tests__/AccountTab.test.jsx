import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
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
    },
    clearSession: vi.fn(),
    setAccessToken: vi.fn(),
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

describe('AccountTab', () => {
    it('renders the re-auth prompt with a Google button', () => {
        const handleReauth = vi.fn();
        const account = {
            reauthRequired: true,
            handleReauth,
            changeEmail: '',
            setChangeEmail: vi.fn(),
        };
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
