import { Link } from 'react-router-dom';
import { AlertCircle, Check, Eye, EyeOff, Shield } from 'lucide-react';
import { PASSWORD_HINT } from '../../utils/password';

/**
 * The Account tab: email and password, privacy, import/export, sign out and
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
        handleChangePassword,
        handleResendVerification,
        handleChangeEmail,
        handleDeleteAccount,
        handleSignOut,
    } = account;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Email & Security */}
            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-accent" />
                    Email & Security
                </h2>

                {/* Email Verification Status */}
                <div className="mb-8 p-4 bg-dark-50 rounded-xl border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-300">Email Status</span>
                        {user?.email_verified ? (
                            <span className="flex items-center gap-1.5 text-green-400 text-sm font-medium bg-green-400/10 px-2 py-1 rounded-lg border border-green-400/20">
                                <Check className="w-3.5 h-3.5" /> Verified
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5 text-yellow-400 text-sm font-medium bg-yellow-400/10 px-2 py-1 rounded-lg border border-yellow-400/20">
                                <AlertCircle className="w-3.5 h-3.5" /> Unverified
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-gray-400 mb-3">{user?.email}</p>

                    {!user?.email_verified && (
                        <button
                            onClick={handleResendVerification}
                            disabled={isResending}
                            className="text-accent hover:text-accent-hover text-sm font-medium disabled:opacity-50"
                        >
                            {isResending ? 'Sending...' : 'Resend Verification Email'}
                        </button>
                    )}
                </div>

                {/* Change Email */}
                <div className="mb-8">
                    <h3 className="text-lg font-medium text-white mb-4">Change Email</h3>
                    <div className="space-y-4 max-w-md">
                        <input
                            type="email"
                            value={changeEmail}
                            onChange={(e) => setChangeEmail(e.target.value)}
                            className="input w-full"
                            placeholder="New Email Address"
                            required
                        />
                        {user.has_password && (
                            <input
                                type="password"
                                value={changeEmailPassword}
                                onChange={(e) => setChangeEmailPassword(e.target.value)}
                                className="input w-full"
                                placeholder="Confirm with Password"
                                required
                            />
                        )}
                        <button
                            onClick={handleChangeEmail}
                            disabled={isChangingEmail || !changeEmail || (user.has_password && !changeEmailPassword)}
                            className="btn-primary w-full sm:w-auto"
                        >
                            {isChangingEmail ? 'Sending Link...' : 'Update Email'}
                        </button>
                    </div>
                    {(accountError || accountSuccess) && (
                        <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${accountSuccess
                            ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                            : 'bg-red-500/10 border border-red-500/20 text-red-400'
                            }`}>
                            {accountSuccess ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            {accountSuccess || accountError}
                        </div>
                    )}
                </div>

                <div className="h-px bg-gray-700 my-6" />

                <h3 className="text-lg font-medium text-white mb-4">
                    {user.has_password ? 'Change Password' : 'Set Password'}
                </h3>

                <div className="space-y-4 max-w-md">
                    {user.has_password && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Current Password</label>
                            <div className="relative">
                                <input
                                    type={showOldPassword ? 'text' : 'password'}
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                    className="input w-full pr-10"
                                    placeholder="Enter current password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowOldPassword(!showOldPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                >
                                    {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* New Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">New Password</label>
                        <div className="relative">
                            <input
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="input w-full pr-10"
                                placeholder="Enter new password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                            >
                                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        <p className="text-gray-500 text-xs mt-1">{PASSWORD_HINT}</p>
                    </div>

                    {/* Confirm Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Confirm New Password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="input w-full"
                            placeholder="Confirm new password"
                        />
                    </div>

                    <button
                        onClick={handleChangePassword}
                        disabled={isSavingAccount || (user.has_password && !oldPassword) || !newPassword || !confirmPassword}
                        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSavingAccount ? 'Saving...' : (user.has_password ? 'Change Password' : 'Set Password')}
                    </button>
                </div>
            </div>

            {/* Privacy Settings */}
            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                <h2 className="text-xl font-semibold text-white mb-6">
                    Privacy
                </h2>

                <div className="flex items-center justify-between max-w-md">
                    <div>
                        <p className="text-white font-medium">Private Profile</p>
                        <p className="text-gray-400 text-sm">Hide your profile from other users</p>
                    </div>
                    <button
                        onClick={handlePrivacyToggle}
                        className={`relative w-14 h-7 rounded-full transition-colors duration-200 
                                ${isPrivate ? 'bg-accent' : 'bg-dark-50 border border-gray-700'}`}
                    >
                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200
                                ${isPrivate ? 'left-8' : 'left-1'}`} />
                    </button>
                </div>

            </div>

            {/* Data Import/Export */}
            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                <h2 className="text-xl font-semibold text-white mb-6">
                    Data Import/Export
                </h2>

                <div className="space-y-4 max-w-md">
                    <Link
                        to="/import"
                        className="flex items-center justify-between p-4 bg-dark-50 hover:bg-dark-200 rounded-xl border border-gray-800 transition-colors group"
                    >
                        <div>
                            <p className="text-white font-medium">Import Data</p>
                            <p className="text-gray-400 text-sm">Import from MyAnimeList or AniList</p>
                        </div>
                    </Link>

                    <Link
                        to="/export"
                        className="flex items-center justify-between p-4 bg-dark-50 hover:bg-dark-200 rounded-xl border border-gray-800 transition-colors group"
                    >
                        <div>
                            <p className="text-white font-medium">Export Data</p>
                            <p className="text-gray-400 text-sm">Download your anime list and reviews</p>
                        </div>
                    </Link>
                </div>
            </div>

            {/* Sign Out */}
            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                <h2 className="text-xl font-semibold text-white mb-2">Session</h2>
                <p className="text-gray-400 text-sm mb-6">
                    Sign out from this device.
                </p>
                <button
                    onClick={handleSignOut}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors font-medium text-sm"
                >
                    Sign Out
                </button>
            </div>

            {/* Delete Account */}
            <div className="bg-red-500/5 p-6 rounded-2xl border border-red-500/20">
                <h2 className="text-xl font-semibold text-red-500 mb-2">Delete Account</h2>
                <p className="text-gray-400 text-sm mb-6">
                    Once you delete your account, there is no going back. Please be certain.
                </p>

                {!showDeleteConfirm ? (
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 rounded-lg transition-colors font-medium text-sm"
                    >
                        Delete Account
                    </button>
                ) : (
                    <div className="max-w-md animate-fade-in">
                        {user.has_password ? (
                            <>
                                <p className="text-sm text-gray-300 mb-3 block">Enter your password to confirm:</p>
                                <div className="flex gap-3">
                                    <input
                                        type="password"
                                        value={deleteAccountPassword}
                                        onChange={(e) => setDeleteAccountPassword(e.target.value)}
                                        className="input flex-1 border-red-500/30 focus:border-red-500 focus:ring-red-500/20"
                                        placeholder="Your Password"
                                    />
                                    <button
                                        onClick={handleDeleteAccount}
                                        disabled={isDeleting || !deleteAccountPassword}
                                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowDeleteConfirm(false);
                                            setDeleteAccountPassword('');
                                        }}
                                        className="px-4 py-2 bg-dark-50 hover:bg-dark-200 text-gray-300 border border-gray-700 rounded-lg transition-colors font-medium text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <p className="text-sm text-gray-300 mb-2">Are you sure you want to delete your account? This action cannot be undone.</p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleDeleteAccount}
                                        disabled={isDeleting}
                                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
                                    >
                                        {isDeleting ? 'Deleting...' : 'Yes, Delete My Account'}
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-4 py-2 bg-dark-50 hover:bg-dark-200 text-gray-300 border border-gray-700 rounded-lg transition-colors font-medium text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
