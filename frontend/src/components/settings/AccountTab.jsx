import { Eye, EyeOff } from 'lucide-react';
import { PASSWORD_HINT } from '../../utils/password';
import SessionsCard from './SessionsCard';
import SettingsSwitch from './SettingsSwitch';

const LABEL = 'block text-sm font-medium text-[var(--text-1)] mb-2';
// Show/hide toggle inside a password field: a full-height 44 px target.
const REVEAL = 'absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]';
// Destructive actions: muted red text, no fill.
const DESTRUCTIVE = 'btn-ghost text-sm !text-[var(--danger)] hover:!bg-[rgb(242_135_143/0.08)]';

/**
 * The Account tab: email and password, privacy, sessions and sign out, and
 * delete. `account` is the state from useAccountSettings; the privacy toggle
 * comes from useProfileSettings because the profile form saves it too.
 */
export default function AccountTab({ user, account, isPrivate, handlePrivacyToggle }) {
    const {
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
        reauthRequired,
        handleReauth,
        isUpdatingPendingEmail,
        handleResendEmailChange,
        handleCancelEmailChange,
        handleChangePassword,
        handleResendVerification,
        handleChangeEmail,
        handleDeleteAccount,
        handleSignOut,
    } = account;

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="panel">
                <h2 className="section-title mb-6">Email and password</h2>

                {reauthRequired && (
                    <div role="alert" className="mb-8">
                        <p className="text-[15px] font-medium text-[var(--text-1)] mb-1">Confirm it's you</p>
                        <p className="text-sm text-[var(--text-2)] mb-3">
                            For your security, sign in with Google again before changing your password,
                            email or account. You'll come back here afterwards.
                        </p>
                        <button type="button" onClick={handleReauth} className="btn-primary text-sm">
                            Continue with Google
                        </button>
                    </div>
                )}

                <div className="mb-8">
                    <p className="text-sm font-medium text-[var(--text-1)]">Email</p>
                    <p className="mt-1 text-sm text-[var(--text-2)] break-all">
                        {user?.email}
                        <span className="text-[var(--text-3)]">
                            {' · '}{user?.email_verified ? 'Verified' : 'Not verified yet'}
                        </span>
                    </p>

                    {!user?.email_verified && (
                        <button
                            type="button"
                            onClick={handleResendVerification}
                            disabled={isResending}
                            className="text-link text-sm disabled:opacity-50"
                        >
                            {isResending ? 'Sending...' : 'Resend verification email'}
                        </button>
                    )}
                </div>

                <div className="mb-10">
                    <h3 className="text-[15px] font-medium text-[var(--text-1)] mb-3">Change email</h3>
                    {user.pending_email && (
                        <div className="mb-4 max-w-md">
                            <p className="text-sm text-[var(--text-2)]">
                                Waiting for confirmation at{' '}
                                <span className="text-[var(--text-1)] font-medium break-all">{user.pending_email}</span>
                            </p>
                            <p className="text-sm text-[var(--text-3)] mt-1">
                                Your current address stays in use until you click the link we sent there.
                            </p>
                            <div className="flex gap-4">
                                <button
                                    type="button"
                                    onClick={handleResendEmailChange}
                                    disabled={isUpdatingPendingEmail}
                                    className="text-link text-sm disabled:opacity-50"
                                >
                                    Resend link
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancelEmailChange}
                                    disabled={isUpdatingPendingEmail}
                                    className="btn-ghost -ml-3 text-sm disabled:opacity-50"
                                >
                                    Cancel change
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="space-y-3 max-w-md">
                        <input
                            type="email"
                            value={changeEmail}
                            onChange={(e) => setChangeEmail(e.target.value)}
                            className="input w-full"
                            placeholder="New email address"
                            aria-label="New email address"
                            required
                        />
                        {user.has_password && (
                            <input
                                type="password"
                                value={changeEmailPassword}
                                onChange={(e) => setChangeEmailPassword(e.target.value)}
                                className="input w-full"
                                placeholder="Your password"
                                aria-label="Your password, to confirm"
                                required
                            />
                        )}
                        <button
                            type="button"
                            onClick={handleChangeEmail}
                            disabled={isChangingEmail || !changeEmail || (user.has_password && !changeEmailPassword)}
                            className="btn-primary w-full sm:w-auto"
                        >
                            {isChangingEmail ? 'Sending link...' : 'Update email'}
                        </button>
                    </div>
                    {(accountError || accountSuccess) && (
                        <p className={`mt-4 text-sm ${accountSuccess ? 'text-[var(--text-2)]' : 'text-[var(--danger)]'}`}>
                            {accountSuccess || accountError}
                        </p>
                    )}
                </div>

                <h3 className="text-[15px] font-medium text-[var(--text-1)] mb-3">
                    {user.has_password ? 'Change password' : 'Set password'}
                </h3>

                <div className="space-y-4 max-w-md">
                    {user.has_password && (
                        <div>
                            <label htmlFor="settings-current-password" className={LABEL}>Current password</label>
                            <div className="relative">
                                <input
                                    id="settings-current-password"
                                    type={showOldPassword ? 'text' : 'password'}
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                    className="input w-full pr-12"
                                    placeholder="Your current password"
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowOldPassword(!showOldPassword)}
                                    aria-label={showOldPassword ? 'Hide password' : 'Show password'}
                                    className={REVEAL}
                                >
                                    {showOldPassword ? <EyeOff aria-hidden="true" className="w-4 h-4" /> : <Eye aria-hidden="true" className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <label htmlFor="settings-new-password" className={LABEL}>New password</label>
                        <div className="relative">
                            <input
                                id="settings-new-password"
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="input w-full pr-12"
                                placeholder="A new password"
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                                className={REVEAL}
                            >
                                {showNewPassword ? <EyeOff aria-hidden="true" className="w-4 h-4" /> : <Eye aria-hidden="true" className="w-4 h-4" />}
                            </button>
                        </div>
                        <p className="text-sm text-[var(--text-3)] mt-2">{PASSWORD_HINT}</p>
                    </div>

                    <div>
                        <label htmlFor="settings-confirm-password" className={LABEL}>Confirm new password</label>
                        <input
                            id="settings-confirm-password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="input w-full"
                            placeholder="The same password again"
                            autoComplete="new-password"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={handleChangePassword}
                        disabled={isSavingAccount || (user.has_password && !oldPassword) || !newPassword || !confirmPassword}
                        className="btn-primary"
                    >
                        {isSavingAccount ? 'Saving...' : (user.has_password ? 'Change password' : 'Set password')}
                    </button>
                </div>
            </section>

            <section className="panel">
                <h2 className="section-title mb-4">Privacy</h2>
                <div className="flex items-start justify-between gap-4">
                    <div className="max-w-md">
                        <p id="private-profile-label" className="text-[15px] font-medium text-[var(--text-1)]">Private profile</p>
                        <p id="private-profile-help" className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
                            Hide your profile, lists and activity from other users. Your reviews and
                            forum posts stay visible on their own pages.
                        </p>
                    </div>
                    <SettingsSwitch
                        checked={isPrivate}
                        onClick={handlePrivacyToggle}
                        labelledBy="private-profile-label"
                        describedBy="private-profile-help"
                    />
                </div>
            </section>

            <section className="panel">
                <h2 className="section-title mb-2">Sessions</h2>
                <div className="mb-4">
                    <SessionsCard />
                </div>
                <button type="button" onClick={handleSignOut} className="btn-secondary text-sm">
                    Sign out
                </button>
            </section>

            <section className="panel">
                <h2 className="section-title mb-2">Delete account</h2>
                <p className="text-sm text-[var(--text-2)] mb-4">
                    This removes your account for good. It can’t be undone.
                </p>

                {!showDeleteConfirm ? (
                    <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        className={`${DESTRUCTIVE} -ml-3`}
                    >
                        Delete account
                    </button>
                ) : (
                    <div className="max-w-md animate-fade-in">
                        {user.has_password ? (
                            <>
                                <label htmlFor="settings-delete-password" className="block text-sm text-[var(--text-2)] mb-2">
                                    Enter your password to confirm
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <input
                                        id="settings-delete-password"
                                        type="password"
                                        value={deleteAccountPassword}
                                        onChange={(e) => setDeleteAccountPassword(e.target.value)}
                                        className="input min-w-0 flex-1 basis-full sm:basis-auto"
                                        placeholder="Your password"
                                        autoComplete="current-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleDeleteAccount}
                                        disabled={isDeleting || !deleteAccountPassword}
                                        className={`${DESTRUCTIVE} whitespace-nowrap`}
                                    >
                                        {isDeleting ? 'Deleting...' : 'Delete my account'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowDeleteConfirm(false);
                                            setDeleteAccountPassword('');
                                        }}
                                        className="btn-ghost text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div>
                                <p className="text-sm text-[var(--text-2)] mb-2">
                                    Are you sure you want to delete your account? This can’t be undone.
                                </p>
                                <div className="flex flex-wrap gap-2 -ml-3">
                                    <button
                                        type="button"
                                        onClick={handleDeleteAccount}
                                        disabled={isDeleting}
                                        className={DESTRUCTIVE}
                                    >
                                        {isDeleting ? 'Deleting...' : 'Yes, delete my account'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="btn-ghost text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
