import { useQuery } from '@tanstack/react-query';
import { User, Heart, List, Star, Settings, Check, Clock, PlayCircle, PauseCircle, XCircle, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi, authApi } from '../api/client';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';

// TABS constant removed as tabs are now hardcoded in the component structure for custom styling

export default function Profile() {
    const { user, isAuthenticated, loading } = useAuth();
    const [activeTab, setActiveTab] = useState('favorites');
    const [bio, setBio] = useState('');
    const [username, setUsername] = useState('');
    const [avatarFile, setAvatarFile] = useState(null);
    const [bannerFile, setBannerFile] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [updateError, setUpdateError] = useState('');

    // Initialize bio and username from user data
    useEffect(() => {
        if (user) {
            if (user.bio) setBio(user.bio);
            if (user.username) setUsername(user.username);
        }
    }, [user]);

    const { data: favorites, isLoading: favoritesLoading } = useQuery({
        queryKey: ['favorites'],
        queryFn: () => favoriteApi.getAll().then(res => res.data.results || res.data),
        enabled: isAuthenticated && activeTab === 'favorites',
    });

    const { data: allLists, isLoading: listsLoading } = useQuery({
        queryKey: ['lists', 'all'],
        queryFn: async () => {
            // Parallel fetch for all statuses
            const statuses = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
            const results = await Promise.all(
                statuses.map(status =>
                    listApi.getAll({ status }).then(res => ({ status, items: res.data.results || res.data }))
                )
            );
            return results;
        },
        enabled: isAuthenticated && activeTab === 'anime_list',
    });

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

    const handleSaveSettings = async () => {
        setIsSaving(true);
        setUpdateError('');
        try {
            const formData = new FormData();
            formData.append('bio', bio);
            formData.append('username', username);
            if (avatarFile) formData.append('avatar', avatarFile);
            if (bannerFile) formData.append('banner', bannerFile);

            await authApi.updateProfile(formData);
            // Reload page to reflect changes properly (simple way to refresh user context)
            window.location.reload();
        } catch (err) {
            console.error('Failed to update profile:', err);
            // Handle both array and string error formats
            const usernameError = err.response?.data?.username;
            let msg = 'Failed to update profile';
            if (usernameError) {
                msg = Array.isArray(usernameError) ? usernameError[0] : usernameError;
            }
            setUpdateError(msg);
        } finally {
            setIsSaving(false);
        }
    };

    const renderAnimeList = () => {
        if (listsLoading) {
            return (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                    {Array(10).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                </div>
            );
        }

        const hasAnyItems = allLists?.some(group => group.items.length > 0);

        if (!hasAnyItems) {
            return (
                <div className="text-center py-16 text-gray-400">
                    <p>Your list is empty.</p>
                </div>
            );
        }

        return (
            <div className="space-y-12">
                {allLists.map((group) => (
                    group.items.length > 0 && (
                        <div key={group.status}>
                            <h3 className="text-xl font-bold text-white mb-4 pl-2 border-l-4 border-accent">
                                {group.status} <span className="text-gray-500 text-sm ml-2">({group.items.length})</span>
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                                {group.items.map((item) => (
                                    <AnimeCard key={item.id} anime={item.anime} />
                                ))}
                            </div>
                        </div>
                    )
                ))}
            </div>
        );
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'favorites':
                return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                        {favoritesLoading ? (
                            Array(6).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)
                        ) : favorites?.length > 0 ? (
                            favorites.map((fav) => <AnimeCard key={fav.id} anime={fav.anime} />)
                        ) : (
                            <p className="col-span-full text-center text-gray-400 py-12">
                                No favorites yet. Start adding some!
                            </p>
                        )}
                    </div>
                );

            case 'anime_list':
                return renderAnimeList();

            case 'settings':
                return (
                    <div className="max-w-xl mx-auto md:mx-0">
                        <div className="space-y-8 bg-dark-100 p-6 rounded-2xl border border-gray-800">
                            {/* Username Input */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Nickname / Username</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="input w-full"
                                    placeholder="Enter your nickname"
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    You can change your username once every 14 days.
                                </p>
                                {updateError && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm mt-2">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        {updateError}
                                    </div>
                                )}
                            </div>

                            {/* Avatar Upload */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Profile Picture</label>
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-full bg-dark-50 border border-gray-700 overflow-hidden flex items-center justify-center">
                                        {avatarFile ? (
                                            <img src={URL.createObjectURL(avatarFile)} alt="Preview" className="w-full h-full object-cover" />
                                        ) : user?.avatar ? (
                                            <img src={user.avatar} alt="Current" className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="w-8 h-8 text-gray-500" />
                                        )}
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => setAvatarFile(e.target.files[0])}
                                        className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                    />
                                </div>
                            </div>

                            {/* Banner Upload */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Banner Image</label>
                                <div className="aspect-[3/1] rounded-xl bg-dark-50 border border-gray-700 overflow-hidden mb-2">
                                    {bannerFile ? (
                                        <img src={URL.createObjectURL(bannerFile)} alt="Preview" className="w-full h-full object-cover" />
                                    ) : user?.banner ? (
                                        <img src={user.banner} alt="Current" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500">
                                            No Banner
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => setBannerFile(e.target.files[0])}
                                    className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                />
                            </div>

                            {/* Bio */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Bio</label>
                                <textarea
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder="Tell us about yourself..."
                                    className="input min-h-[120px] resize-none w-full"
                                />
                            </div>

                            <button
                                onClick={handleSaveSettings}
                                disabled={isSaving}
                                className="btn-primary w-full md:w-auto"
                            >
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen pb-20">
            {/* Banner Section */}
            <div className="relative h-48 md:h-64 bg-dark-100">
                {user?.banner ? (
                    <img src={user.banner} alt="Banner" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-gradient-to-r from-gray-900 to-gray-800" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-dark-200 to-transparent" />
            </div>

            <div className="max-w-7xl mx-auto px-4 relative -mt-20">
                {/* Profile Header Card - Mobile: Stack, Desktop: Row */}
                <div className="flex flex-col items-center md:flex-row md:items-end gap-4 md:gap-6 mb-8">
                    {/* Avatar */}
                    <div className="w-28 h-28 md:w-40 md:h-40 rounded-full border-4 border-dark-200 bg-dark-100 overflow-hidden shadow-xl shrink-0 transition-transform duration-300 hover:scale-105">
                        {user?.avatar ? (
                            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                <User className="w-12 h-12 md:w-16 md:h-16 text-white" />
                            </div>
                        )}
                    </div>

                    {/* User Info - Center on mobile */}
                    <div className="flex-1 text-center md:text-left mb-2 md:mb-0">
                        <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">{user?.username}</h1>
                        <p className="text-gray-400 text-sm md:text-base mb-3">{user?.email}</p>
                        {user?.bio && (
                            <p className="text-gray-300 text-sm md:text-base max-w-2xl bg-dark-100/50 p-3 rounded-lg backdrop-blur-sm border border-white/5 mx-auto md:mx-0">
                                {user.bio}
                            </p>
                        )}
                    </div>

                    {/* Stats - Always visible */}
                    <div className="flex gap-8 md:gap-6 pb-2 md:pb-4">
                        <div className="text-center transition-transform duration-200 hover:scale-110">
                            <div className="text-xl md:text-2xl font-bold text-white">{user?.favorites_count || 0}</div>
                            <div className="text-xs md:text-sm text-gray-400">Favorites</div>
                        </div>
                        <div className="text-center transition-transform duration-200 hover:scale-110">
                            <div className="text-xl md:text-2xl font-bold text-white">{user?.reviews_count || 0}</div>
                            <div className="text-xs md:text-sm text-gray-400">Reviews</div>
                        </div>
                    </div>
                </div>

                {/* Tabs with smooth indicator transition */}
                <div className="border-b border-gray-800 mb-8">
                    <div className="flex gap-4 md:gap-8 overflow-x-auto scrollbar-hide justify-center md:justify-start">
                        <button
                            onClick={() => setActiveTab('favorites')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'favorites' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Favorites
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'favorites' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('anime_list')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'anime_list' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Anime List
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'anime_list' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'settings' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Settings
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'settings' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                    </div>
                </div>

                {/* Content with fade transition */}
                <div className="min-h-[400px] animate-fade-in">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}
