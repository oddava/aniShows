import { Link, NavLink, useLocation } from 'react-router-dom';
import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

import Logo from './Logo';
import NavItem from './navbar/NavItem';
import NavbarSearch from './navbar/NavbarSearch';
import UserMenu from './navbar/UserMenu';
import MobileNav from './navbar/MobileNav';
import MobileTopBar from './navbar/MobileTopBar';
import useNavbarSearch from './navbar/useNavbarSearch';
import useNavbarAutoHide from './navbar/useNavbarAutoHide';
import useNavbarNotifications from './navbar/useNavbarNotifications';

/** Desktop bell with the unread count, one click from anywhere (N1). */
function NotificationBell({ count = 0 }) {
    const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';
    return (
        <NavLink
            to="/notifications"
            aria-label={label}
            title={label}
            className={({ isActive }) => `relative mr-1 flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${isActive ? 'text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
        >
            <Bell aria-hidden="true" className="h-5 w-5" />
            {count > 0 && (
                <span aria-hidden="true" className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-[var(--signature)] px-1 text-center text-[11px] font-bold leading-[18px] text-[var(--on-signature)] tabular">
                    {count > 9 ? '9+' : count}
                </span>
            )}
        </NavLink>
    );
}

export default function Navbar() {
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const { user, logout, isAuthenticated, loading: authLoading } = useAuth();

    // The search state lives here (via the hook) because the auto-hide logic
    // has to know whether the search is in use.
    const search = useNavbarSearch({ setIsProfileOpen });
    const { isSearchExpanded, showSuggestions, isSearching } = search;

    // Unread badge: fetched when signed in, then kept current by WebSocket pushes.
    const mobileUnreadCount = useNavbarNotifications({ user, isAuthenticated });

    // Auto-hide navbar logic
    const isVisible = useNavbarAutoHide({ isSearchExpanded, isProfileOpen, showSuggestions, isSearching });

    const currentUserProfilePath = user?.username ? `/u/${user.username}` : '/profile';

    // Browse has its own search box at the top of the page; one is enough.
    const location = useLocation();
    const showNavSearch = location.pathname.replace(/\/+$/, '') !== '/browse';

    return (
        <>
            <MobileTopBar />
            <nav
                aria-label="Main"
                data-autohide-nav
                className={`hidden md:block fixed inset-x-0 top-0 z-[1000] backdrop-blur-md transition-[transform,opacity] duration-200 ease-out ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}`}
                style={{ background: 'var(--color-navbar-bg)' }}
            >
                <div className="page-container">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}
                        <Link to="/" className="rounded-md" aria-label="AniShows home">
                            <Logo />
                        </Link>

                        {/* Desktop Nav */}
                        <div className="hidden md:flex items-center gap-6 flex-1 ml-10">
                            <NavItem to="/browse" label="Browse" />
                            <NavItem to="/schedule" label="Schedule" />
                            {(isAuthenticated || authLoading) && (
                                <NavItem to="/list" label="My List" />
                            )}

                            {/* Search - Collapsible */}
                            {showNavSearch ? <NavbarSearch search={search} /> : <div className="flex-1" />}
                        </div>

                        {/* Right Section: notifications (N1), then the account menu */}
                        {isAuthenticated && <NotificationBell count={mobileUnreadCount} />}
                        <UserMenu
                            user={user}
                            isAuthenticated={isAuthenticated}
                            authLoading={authLoading}
                            logout={logout}
                            isProfileOpen={isProfileOpen}
                            setIsProfileOpen={setIsProfileOpen}
                            mobileUnreadCount={mobileUnreadCount}
                            currentUserProfilePath={currentUserProfilePath}
                        />

                        <div className="md:hidden w-6" />
                    </div>
                </div>
            </nav>

            {/* Mobile Bottom Navigation Island */}
            <MobileNav
                user={user}
                isAuthenticated={isAuthenticated}
                logout={logout}
                mobileUnreadCount={mobileUnreadCount}
                currentUserProfilePath={currentUserProfilePath}
            />
        </>
    );
}
