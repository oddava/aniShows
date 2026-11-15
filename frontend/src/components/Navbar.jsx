import { Link, useLocation } from 'react-router-dom';
import React, { useState } from 'react';
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
                className={`hidden md:block fixed top-4 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-2rem)] max-w-6xl rounded-2xl border border-white/10 bg-dark/70 backdrop-blur-xl transition-all duration-300 ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0 pointer-events-none'}`}
                style={{
                    background: 'var(--color-navbar-bg)',
                    borderColor: 'var(--color-navbar-border)',
                }}
            >
                <div className="px-4 sm:px-6">
                    <div className="flex items-center justify-between h-14">
                        {/* Logo */}
                        <Link to="/" className="rounded-md" aria-label="AniShows home">
                            <Logo />
                        </Link>

                        {/* Desktop Nav */}
                        <div className="hidden md:flex items-center gap-1.5 flex-1 ml-6 lg:ml-8">
                            <NavItem to="/browse" label="Browse" />
                            <NavItem to="/schedule" label="Schedule" />
                            {(isAuthenticated || authLoading) && (
                                <NavItem to={currentUserProfilePath} label="My List" />
                            )}

                            {/* Search - Collapsible */}
                            {showNavSearch ? <NavbarSearch search={search} /> : <div className="flex-1" />}
                        </div>

                        {/* Right Section: Auth */}
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
