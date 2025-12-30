import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { User, Lock, Shield, Eye, EyeOff, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';

export default function Settings() {
    const { user, isAuthenticated, loading } = useAuth();
    const [activeTab, setActiveTab] = useState('profile');

    // Profile settings state
    const [bio, setBio] = useState('');
    const [username, setUsername] = useState('');
    const [avatarFile, setAvatarFile] = useState(null);
    const [bannerFile, setBannerFile] = useState(null);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');

    // Account settings state
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [isSavingAccount, setIsSavingAccount] = useState(false);
    const [accountError, setAccountError] = useState('');
    const [accountSuccess, setAccountSuccess] = useState('');

    // Initialize state from user data
    useEffect(() => {
        if (user) {
            if (user.bio) setBio(user.bio);
            if (user.username) setUsername(user.username);
            setIsPrivate(user.is_private || false);
        }
    }, [user]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        setProfileError('');
        setProfileSuccess('');
        try {
            const formData = new FormData();
            formData.append('bio', bio);
            formData.append('username', username);
            if (avatarFile) formData.append('avatar', avatarFile);
            if (bannerFile) formData.append('banner', bannerFile);

            await authApi.updateProfile(formData);
            setProfileSuccess('Profile updated successfully!');
            // Reload page to reflect changes in header
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            console.error('Failed to update profile:', err);
            const usernameError = err.response?.data?.username;
            let msg = 'Failed to update profile';
            if (usernameError) {
                msg = Array.isArray(usernameError) ? usernameError[0] : usernameError;
            }
            setProfileError(msg);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            setAccountError('New passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            setAccountError('Password must be at least 8 characters');
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
            console.error('Failed to change password:', err);
            const oldPassError = err.response?.data?.old_password;
            let msg = 'Failed to change password';
            if (oldPassError) {
                msg = Array.isArray(oldPassError) ? oldPassError[0] : oldPassError;
            }
            setAccountError(msg);
        } finally {
            setIsSavingAccount(false);
        }
    };

    const handlePrivacyToggle = async () => {
        const newPrivacy = !isPrivate;
        setIsPrivate(newPrivacy);
        try {
            await authApi.updateProfile({ is_private: newPrivacy });
        } catch (err) {
            console.error('Failed to update privacy:', err);
            setIsPrivate(!newPrivacy); // Revert on failure
        }
    };

    return (
        <div className="min-h-screen py-20 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
                    <p className="text-gray-400">Manage your profile and account settings</p>
                </div>

                {/* Tabs */}
                <div className="flex gap-4 mb-8 border-b border-gray-800">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className={`flex items-center gap-2 pb-4 px-2 font-medium transition-all duration-200 relative
                            ${activeTab === 'profile' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                    >
                        <User className="w-4 h-4" />
                        Profile
                        <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left 
                            ${activeTab === 'profile' ? 'scale-x-100' : 'scale-x-0'}`} />
                    </button>
                    <button
                        onClick={() => setActiveTab('account')}
                        className={`flex items-center gap-2 pb-4 px-2 font-medium transition-all duration-200 relative
                            ${activeTab === 'account' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                    >
                        <Shield className="w-4 h-4" />
                        Account
                        <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left 
                            ${activeTab === 'account' ? 'scale-x-100' : 'scale-x-0'}`} />
                    </button>
                </div>

                {/* Profile Tab */}
                {activeTab === 'profile' && (
                    <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800 animate-fade-in">
                        <h2 className="text-xl font-semibold text-white mb-6">Profile Settings</h2>

                        <div className="space-y-6">
                            {/* Username */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="input w-full max-w-md"
                                    placeholder="Enter your username"
                                />
                                <p className="text-xs text-gray-500 mt-2">You can change your username once every 14 days.</p>
                            </div>

                            {/* Avatar */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Profile Picture</label>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 rounded-full bg-dark-50 border border-gray-700 overflow-hidden flex items-center justify-center">
                                        {avatarFile ? (
                                            <img src={URL.createObjectURL(avatarFile)} alt="Preview" className="w-full h-full object-cover" />
                                        ) : user?.avatar ? (
                                            <img src={user.avatar} alt="Current" className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="w-10 h-10 text-gray-500" />
                                        )}
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => setAvatarFile(e.target.files[0])}
                                        className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 
                                                   file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                    />
                                </div>
                            </div>

                            {/* Banner */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Banner Image</label>
                                <div className="aspect-[4/1] max-w-2xl rounded-xl bg-dark-50 border border-gray-700 overflow-hidden mb-2">
                                    {bannerFile ? (
                                        <img src={URL.createObjectURL(bannerFile)} alt="Preview" className="w-full h-full object-cover" />
                                    ) : user?.banner ? (
                                        <img src={user.banner} alt="Current" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500">No Banner</div>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => setBannerFile(e.target.files[0])}
                                    className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 
                                               file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                />
                            </div>

                            {/* Bio */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Bio</label>
                                <textarea
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder="Tell us about yourself..."
                                    className="input min-h-[120px] resize-none w-full max-w-xl"
                                />
                            </div>

                            {/* Error/Success */}
                            {profileError && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    {profileError}
                                </div>
                            )}
                            {profileSuccess && (
                                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-400 text-sm">
                                    <Check className="w-4 h-4 shrink-0" />
                                    {profileSuccess}
                                </div>
                            )}

                            <button
                                onClick={handleSaveProfile}
                                disabled={isSavingProfile}
                                className="btn-primary"
                            >
                                {isSavingProfile ? 'Saving...' : 'Save Profile'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Account Tab */}
                {activeTab === 'account' && (
                    <div className="space-y-6 animate-fade-in">
                        {/* Change Password */}
                        <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                                <Lock className="w-5 h-5 text-accent" />
                                Change Password
                            </h2>

                            <div className="space-y-4 max-w-md">
                                {/* Current Password */}
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

                                {/* Error/Success */}
                                {accountError && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        {accountError}
                                    </div>
                                )}
                                {accountSuccess && (
                                    <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-400 text-sm">
                                        <Check className="w-4 h-4 shrink-0" />
                                        {accountSuccess}
                                    </div>
                                )}

                                <button
                                    onClick={handleChangePassword}
                                    disabled={isSavingAccount || !oldPassword || !newPassword || !confirmPassword}
                                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSavingAccount ? 'Changing...' : 'Change Password'}
                                </button>
                            </div>
                        </div>

                        {/* Privacy Settings */}
                        <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                                <Shield className="w-5 h-5 text-accent" />
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
                    </div>
                )}
            </div>
        </div>
    );
}
