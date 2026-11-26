import { useEffect, useId, useRef } from 'react';
import usePresence from '../../hooks/usePresence';
import { Link, useLocation } from 'react-router-dom';
import { Bell, ChevronDown, LayoutDashboard, LogOut, Settings, User } from 'lucide-react';
import useSignOut from '../auth/useSignOut';
import { isAuthFlowPath } from '../auth/authPaths';

/**
 * The right side of the desktop navbar: a skeleton while auth loads, the
 * profile button and its dropdown when signed in, or the sign-in links
 * (left out on the sign-in / sign-up pages themselves).
 * `isProfileOpen` is owned by Navbar (auto-hide and Escape need it).
 * Sign out goes through useSignOut (toast + home), not a `logout` prop.
 */
export default function UserMenu({
    user,
    isAuthenticated,
    authLoading,
    isProfileOpen,
    setIsProfileOpen,
    mobileUnreadCount,
    currentUserProfilePath,
}) {
    const profileRef = useRef(null);
    const profileButtonRef = useRef(null);
    const profileMenuId = useId();
    const signOut = useSignOut();
    const { pathname } = useLocation();

    // Escape closes the dropdown and returns focus to its button.
    const menu = usePresence(isProfileOpen, 120);

    useEffect(() => {
        if (!isProfileOpen) return undefined;
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            setIsProfileOpen(false);
            profileButtonRef.current?.focus();
        };
        // Capture phase: runs before other document listeners can close the
        // menu (and unmount it) without restoring focus.
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isProfileOpen, setIsProfileOpen]);

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
                // Sized like the signed-in bell + account chip, so the search
                // box beside it does not slide when auth resolves.
                <div aria-hidden="true" className="flex items-center gap-1">
                    <div className="h-11 w-11" />
                    <div className="skeleton-shimmer h-10 w-[9.5rem] rounded-lg" />
                </div>
            ) : isAuthenticated ? (
                <div
                    className="relative"
                    ref={profileRef}
                    onBlur={(event) => {
                        // Close when keyboard focus leaves the button and its menu.
                        if (isProfileOpen && !profileRef.current?.contains(event.relatedTarget)) {
                            setIsProfileOpen(false);
                        }
                    }}
                >
                    {/* Profile Button */}
                    <button
                        ref={profileButtonRef}
                        type="button"
                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                        aria-expanded={isProfileOpen}
                        aria-controls={isProfileOpen ? profileMenuId : undefined}
                        // The name starts with what the button shows, the username (WCAG 2.5.3).
                        aria-label={`${user?.username || 'You'}, account menu${mobileUnreadCount > 0 ? `, ${mobileUnreadCount} unread notifications` : ''}`}
                        className="press relative group flex h-10 items-center gap-2.5 rounded-lg pl-1.5 pr-2.5 transition-colors duration-150 hover:bg-white/[0.06]"
                    >
                        {/* Avatar or Placeholder */}
                        <div aria-hidden="true" className="w-7 h-7 rounded-full overflow-hidden ">
                            {user?.avatar ? (
                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-[var(--signature-soft)] flex items-center justify-center">
                                    <span className="text-sm font-semibold uppercase text-[var(--signature)]">{user?.username?.charAt(0)}</span>
                                </div>
                            )}
                        </div>
                        {isAuthenticated && mobileUnreadCount > 0 && (
                            <span className="absolute top-1 left-7 w-2 h-2 bg-red-500 rounded-full ring-2 ring-dark shadow-sm z-10" />
                        )}
                        <span className="text-[15px] font-medium text-[var(--text-1)] max-w-[120px] truncate">
                            {user?.username}
                        </span>
                        <ChevronDown aria-hidden="true" className={`w-4 h-4 text-[var(--text-3)] transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Enhanced Dropdown Menu */}
                    {menu.mounted && (
                        <div id={profileMenuId} data-state={menu.closing ? 'closing' : 'open'} data-side="bottom" className="popover-in absolute right-0 top-full mt-3 w-64 py-1.5 rounded-xl bg-[var(--ink-3)] shadow-[var(--shadow-pop)] z-[1001]">
                            {/* User Info Header */}
                            <div className="px-4 py-3 mb-1.5">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full overflow-hidden">
                                        {user?.avatar ? (
                                            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-[var(--signature-soft)] flex items-center justify-center">
                                                <span className="text-base font-semibold uppercase text-[var(--signature)]">{user?.username?.charAt(0)}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">{user?.username}</p>
                                        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Menu Items */}
                            <div className="px-1.5 space-y-0.5">
                                <Link
                                    to={currentUserProfilePath}
                                    onClick={() => setIsProfileOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                                >
                                    <User aria-hidden="true" className="w-4 h-4" />
                                    <span className="text-sm font-medium">Profile</span>
                                </Link>
                                <Link
                                    to="/notifications"
                                    onClick={() => setIsProfileOpen(false)}
                                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                                >
                                    <span className="flex items-center gap-3 min-w-0">
                                        <Bell aria-hidden="true" className="w-4 h-4" />
                                        <span className="text-sm font-medium">Notifications</span>
                                    </span>
                                    {mobileUnreadCount > 0 && (
                                        <span
                                            className="w-2 h-2 rounded-full bg-accent"
                                            aria-label="New notifications"
                                        />
                                    )}
                                </Link>
                                <Link
                                    to="/settings?tab=account"
                                    onClick={() => setIsProfileOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                                >
                                    <Settings aria-hidden="true" className="w-4 h-4" />
                                    <span className="text-sm font-medium">Settings</span>
                                </Link>
                                {(user?.is_staff || user?.is_superuser) && (
                                    <Link
                                        to="/admin"
                                        onClick={() => setIsProfileOpen(false)}
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                                    >
                                        <LayoutDashboard aria-hidden="true" className="w-4 h-4" />
                                        <span className="text-sm font-medium">Admin</span>
                                    </Link>
                                )}
                                <div className=" my-1.5 mx-2" />
                                <button
                                    type="button"
                                    onClick={() => { setIsProfileOpen(false); signOut(); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-300 transition-colors hover:bg-red-500/10 hover:text-red-400"
                                >
                                    <LogOut aria-hidden="true" className="w-4 h-4" />
                                    <span className="text-sm font-medium">Sign out</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : isAuthFlowPath(pathname) ? null : (
                <>
                    <Link to="/login" className="flex min-h-11 items-center px-3 text-[15px] text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]">
                        Sign in
                    </Link>
                    <Link to="/register" className="btn-primary px-4 text-[15px]">
                        Create account
                    </Link>
                </>
            )}
        </div>
    );
}
