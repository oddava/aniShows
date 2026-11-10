import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Settings, User } from 'lucide-react';

/**
 * The right side of the desktop navbar: a skeleton while auth loads, the
 * profile button and its dropdown when signed in, or the sign-in links.
 * `isProfileOpen` is owned by Navbar (auto-hide and Escape need it).
 */
export default function UserMenu({
    user,
    isAuthenticated,
    authLoading,
    logout,
    isProfileOpen,
    setIsProfileOpen,
    mobileUnreadCount,
    currentUserProfilePath,
}) {
    const profileRef = useRef(null);

    // Close the dropdown when clicking outside it
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [setIsProfileOpen]);

    return (
        <div className="hidden md:flex items-center gap-3">
            {authLoading ? (
                // Loading state - show skeleton instead of "Sign In" buttons
                <div className="flex items-center gap-2">
                    <div className="w-20 h-9 bg-white/5 rounded-xl animate-pulse" />
                    <div className="w-9 h-9 bg-white/5 rounded-full animate-pulse" />
                </div>
            ) : isAuthenticated ? (
                <div className="relative" ref={profileRef}>
                    {/* Profile Button */}
                    <button
                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                        className="relative group flex items-center gap-3 rounded-full border border-white/5 bg-black/20 pl-1.5 pr-4 py-1 transition-all duration-300 hover:border-white/10 hover:bg-black/40 hover:shadow-[0_0_20px_rgba(117,105,141,0.12)] focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                        {/* Avatar or Placeholder */}
                        <div className="w-7 h-7 rounded-full overflow-hidden border border-transparent group-hover:border-white/20 transition-all duration-300">
                            {user?.avatar ? (
                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-accent flex items-center justify-center">
                                    <span className="text-sm font-bold text-white uppercase">{user?.username?.charAt(0)}</span>
                                </div>
                            )}
                        </div>
                        {isAuthenticated && mobileUnreadCount > 0 && (
                            <span className="absolute top-1 left-7 w-2h-2 bg-red-500 rounded-full ring-2 ring-dark shadow-sm z-10" />
                        )}
                        <span className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors max-w-[100px] truncate">
                            {user?.username}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 group-hover:text-white transition-all duration-300 ${isProfileOpen ? 'rotate-180 text-white' : ''}`} />
                    </button>

                    {/* Enhanced Dropdown Menu */}
                    {isProfileOpen && (
                        <div className="absolute right-0 top-full mt-4 w-72 py-2 rounded-2xl border border-white/10 bg-dark/95 backdrop-blur-xl shadow-2xl origin-top-right animate-in fade-in zoom-in-95 duration-200 z-[1001]">
                            {/* User Info Header */}
                            <div className="px-4 py-3 border-b border-white/10 bg-white/5 mx-2 rounded-xl mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 shadow-sm">
                                        {user?.avatar ? (
                                            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-accent flex items-center justify-center">
                                                <span className="text-xl font-bold text-white uppercase">{user?.username?.charAt(0)}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-white truncate drop-shadow-sm">{user?.username}</p>
                                        <p className="text-xs text-gray-400/80 truncate">{user?.email}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Menu Items */}
                            <div className="py-1 px-2 space-y-0.5">
                                <Link
                                    to={currentUserProfilePath}
                                    onClick={() => setIsProfileOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none group"
                                >
                                    <User className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-medium">Profile</span>
                                </Link>
                                <Link
                                    to="/notifications"
                                    onClick={() => setIsProfileOpen(false)}
                                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none group"
                                >
                                    <span className="flex items-center gap-3 min-w-0">
                                        <Bell className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                        <span className="text-sm font-medium">Notifications</span>
                                    </span>
                                    {mobileUnreadCount > 0 && (
                                        <span
                                            className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_0_2px_rgba(17,24,39,1)]"
                                            aria-label="New notifications"
                                        />
                                    )}
                                </Link>
                                <Link
                                    to="/settings"
                                    onClick={() => setIsProfileOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none group"
                                >
                                    <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform" />
                                    <span className="text-sm font-medium">Settings</span>
                                </Link>
                                <div className="border-t border-white/10 my-2 mx-2" />
                                <button
                                    onClick={() => { logout(); setIsProfileOpen(false); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-red-500/15 hover:text-red-400 focus:outline-none group"
                                >
                                    <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                                    <span className="text-sm font-medium">Sign Out</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <Link to="/login" className="text-gray-300 hover:text-white transition-colors font-medium px-3 py-2 focus:outline-none">
                        Sign In
                    </Link>
                    <Link to="/register" className="btn-primary text-sm py-2 px-4 focus:outline-none">
                        Get Started
                    </Link>
                </>
            )}
        </div>
    );
}
