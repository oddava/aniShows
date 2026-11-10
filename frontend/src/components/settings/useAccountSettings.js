import { useState } from 'react';
import { getApiErrorMessage } from '../../api/errors';
import { authApi, clearSession } from '../../api/client';
import { getPasswordProblem } from '../../utils/password';
import logger from '../../utils/logger';

/**
 * Account-tab state for the Settings page: password, email change, resend
 * verification, delete account and sign out. Kept in Settings so typed values
 * survive switching tabs.
 */
export default function useAccountSettings({ user, logout }) {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [isSavingAccount, setIsSavingAccount] = useState(false);
    const [accountError, setAccountError] = useState('');
    const [accountSuccess, setAccountSuccess] = useState('');

    // Additional Account States
    const [isResending, setIsResending] = useState(false);
    const [changeEmail, setChangeEmail] = useState('');
    const [changeEmailPassword, setChangeEmailPassword] = useState('');
    const [isChangingEmail, setIsChangingEmail] = useState(false);
    const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            setAccountError('New passwords do not match');
            return;
        }
        const passwordProblem = getPasswordProblem(newPassword);
        if (passwordProblem) {
            setAccountError(passwordProblem);
            return;
        }

        setIsSavingAccount(true);
        setAccountError('');
        setAccountSuccess('');
        try {
            await authApi.changePassword({
                old_password: oldPassword,
                new_password: newPassword
            });
            setAccountSuccess('Password changed successfully!');
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            logger.error('Failed to change password:', err);
            setAccountError(getApiErrorMessage(err, 'Failed to change password'));
        } finally {
            setIsSavingAccount(false);
        }
    };

    const handleResendVerification = async () => {
        setIsResending(true);
        try {
            await authApi.resendVerification(user.email);
            setAccountSuccess('Verification email sent!');
        } catch (err) {
            setAccountError('Failed to send verification email');
        } finally {
            setIsResending(false);
        }
    };

    const handleChangeEmail = async () => {
        if (!changeEmail) return;
        if (user.has_password && !changeEmailPassword) {
            setAccountError('Current password is required to change email');
            return;
        }
        setIsChangingEmail(true);
        setAccountError('');
        setAccountSuccess('');
        try {
            await authApi.changeEmail({
                new_email: changeEmail,
                password: user.has_password ? changeEmailPassword : null
            });
            setAccountSuccess('Confirmation email sent to new address!');
            setChangeEmail('');
            setChangeEmailPassword('');
        } catch (err) {
            setAccountError(getApiErrorMessage(err, 'Failed to change email'));
        } finally {
            setIsChangingEmail(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (user.has_password && !deleteAccountPassword) {
            setAccountError('Current password is required to delete account');
            return;
        }
        setIsDeleting(true);
        try {
            await authApi.deleteAccount({
                password: user.has_password ? deleteAccountPassword : null
            });
            // Forget the session so the reload doesn't try to restore it
            clearSession();
            // Force hard reload to reset application state
            window.location.href = '/';
        } catch (err) {
            logger.error("Delete failed:", err);
            setAccountError(getApiErrorMessage(err, 'Failed to delete account'));
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSignOut = () => {
        logout();
    };

    return {
        oldPassword, setOldPassword,
        newPassword, setNewPassword,
        confirmPassword, setConfirmPassword,
        showOldPassword, setShowOldPassword,
        showNewPassword, setShowNewPassword,
        isSavingAccount,
        accountError,
        accountSuccess,
        isResending,
        changeEmail, setChangeEmail,
        changeEmailPassword, setChangeEmailPassword,
        isChangingEmail,
        deleteAccountPassword, setDeleteAccountPassword,
        isDeleting,
        showDeleteConfirm, setShowDeleteConfirm,
        handleChangePassword,
        handleResendVerification,
        handleChangeEmail,
        handleDeleteAccount,
        handleSignOut,
    };
}
