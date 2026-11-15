import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, Compass, Home, User } from 'lucide-react';

/**
 * The mobile bottom navigation island (Home, Browse, Schedule, Notifs when
 * signed in, Account), shown on
 * the main sections only. A long press on Account opens its menu; a tap goes
 * to the user's profile.
 */
export default function MobileNav({ user, isAuthenticated, logout, mobileUnreadCount, currentUserProfilePath }) {
    const [isMobileAccountOpen, setIsMobileAccountOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const mobileAccountRef = useRef(null);
    const accountHoldTimerRef = useRef(null);
    const longPressTriggeredRef = useRef(false);

    // Close the popovers when clicking outside them
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (mobileAccountRef.current && !mobileAccountRef.current.contains(event.target)) {
                setIsMobileAccountOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        setIsMobileAccountOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        return () => {
            if (accountHoldTimerRef.current) {
                clearTimeout(accountHoldTimerRef.current);
            }
        };
    }, []);

    const isProfileRoute = location.pathname === '/profile'
        || location.pathname.startsWith('/profile/')
        || location.pathname.startsWith('/u/');
    const isOnCurrentUserProfile = Boolean(user?.username) && (
        location.pathname === currentUserProfilePath
        || location.pathname.startsWith(`${currentUserProfilePath}/`)
    );
    const mobileProfilePath = isAuthenticated ? currentUserProfilePath : '/login';
    const mobileProfileLabel = isAuthenticated ? 'Profile' : 'Sign In';

    const showMobileIsland = useMemo(() => {
        const mainPaths = ['/', '/browse', '/schedule', '/forums', '/profile', '/u', '/settings', '/notifications'];
        return mainPaths.some((path) => {
            if (path === '/') return location.pathname === '/';
            return location.pathname === path || location.pathname.startsWith(`${path}/`);
        });
    }, [location.pathname]);

    const isPathActive = (path) => {
        if (path === '/browse' || path === '/schedule') {
            return location.pathname === path;
        }
        return location.pathname.startsWith(path);
    };

    const mobileTabClasses = (isActive) => `
        group relative min-w-0 flex h-12 flex-col items-center justify-center rounded-[1.1rem] border border-transparent px-0.5 transition-colors duration-200 [-webkit-tap-highlight-color:transparent]
        ${isActive
            ? 'bg-white/[0.08] text-white'
            : 'text-gray-400 hover:bg-white/[0.06] hover:text-white active:bg-white/[0.06]'
        }
    `;

    const mobileIslandBackground = 'var(--color-surface-glass)';
    const mobilePopoverBackground = 'color-mix(in srgb, var(--color-dark-50) 94%, transparent)';
    const mobilePopoverTipBackground = 'color-mix(in srgb, var(--color-dark-50) 94%, transparent)';

    const startAccountHold = () => {
        longPressTriggeredRef.current = false;
        if (accountHoldTimerRef.current) {
            clearTimeout(accountHoldTimerRef.current);
        }
        accountHoldTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            setIsMobileAccountOpen(true);
        }, 350);
    };

    const endAccountHold = () => {
        if (accountHoldTimerRef.current) {
            clearTimeout(accountHoldTimerRef.current);
            accountHoldTimerRef.current = null;
        }
        if (!longPressTriggeredRef.current) {
            setIsMobileAccountOpen(false);
            if (!isOnCurrentUserProfile) {
                navigate(currentUserProfilePath);
            }
        }
    };

    const cancelAccountHold = () => {
        if (accountHoldTimerRef.current) {
            clearTimeout(accountHoldTimerRef.current);
            accountHoldTimerRef.current = null;
        }
    };

    if (!showMobileIsland) return null;

    return (
        <nav
            aria-label="Primary"
            className="md:hidden fixed bottom-[max(0.4rem,env(safe-area-inset-bottom))] inset-x-[0.45rem] z-[1001] mx-auto w-auto max-w-[380px] select-none"
            style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
        >
            <div
                className="rounded-[1.45rem] border border-white/12 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150"
                style={{ background: mobileIslandBackground }}
            >
                <div className={`grid ${isAuthenticated ? 'grid-cols-5' : 'grid-cols-4'} gap-0.5`}>
                    <Link
                        to="/"
                        aria-current={location.pathname === '/' ? 'page' : undefined}
                        className={mobileTabClasses(location.pathname === '/')}
                    >
                        <Home className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">Home</span>
                    </Link>
                    <Link
                        to="/browse"
                        aria-current={isPathActive('/browse') ? 'page' : undefined}
                        className={mobileTabClasses(isPathActive('/browse'))}
                    >
                        <Compass aria-hidden="true" className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">Browse</span>
                    </Link>
                    <Link
                        to="/schedule"
                        aria-current={isPathActive('/schedule') ? 'page' : undefined}
                        className={mobileTabClasses(isPathActive('/schedule'))}
                    >
                        <CalendarDays aria-hidden="true" className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">Schedule</span>
                    </Link>
                    {isAuthenticated && (
                    <Link
                        to="/notifications"
                        aria-label={mobileUnreadCount > 0 ? `Notifications, ${mobileUnreadCount} unread` : 'Notifications'}
                        className={mobileTabClasses(isPathActive('/notifications'))}
                    >
                        <span className="relative inline-flex">
                            {isAuthenticated && mobileUnreadCount > 0 && (
                                <span className="absolute -right-2 -top-2 z-10 h-[13px] min-w-[13px] rounded-full bg-red-500 px-1 text-center text-[8px] font-semibold leading-[13px] text-white">
                                    {mobileUnreadCount > 9 ? '9+' : mobileUnreadCount}
                                </span>
                            )}
                            <Bell className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                        </span>
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">Notifs</span>
                    </Link>
                    )}
                    <div className="relative min-w-0" ref={mobileAccountRef}>
                        {isAuthenticated ? (
                            <>
                                <button
                                    type="button"
                                    onPointerDown={startAccountHold}
                                    onPointerUp={endAccountHold}
                                    onPointerLeave={cancelAccountHold}
                                    onPointerCancel={cancelAccountHold}
                                    onContextMenu={(e) => e.preventDefault()}
                                    className={`w-full ${mobileTabClasses(isProfileRoute || isPathActive('/settings'))}`}
                                >
                                    {user?.avatar ? (
                                        <img
                                            src={user.avatar}
                                            alt={user.username}
                                            className="h-3.5 w-3.5 rounded-full object-cover ring-1 ring-white/15"
                                        />
                                    ) : (
                                        <User className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                    )}
                                    <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">Account</span>
                                </button>
                                {isMobileAccountOpen && (
                                    <div
                                        className="absolute bottom-full right-0 mb-2.5 w-36 overflow-hidden rounded-xl border border-white/12 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                                        style={{ background: mobilePopoverBackground }}
                                    >
                                        <div
                                            className="absolute -bottom-1.5 right-4 h-3 w-3 rotate-45 border-r border-b border-white/12"
                                            style={{ backgroundColor: mobilePopoverTipBackground }}
                                        />
                                        {!isOnCurrentUserProfile && (
                                            <Link
                                                to={currentUserProfilePath}
                                                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/10"
                                            >
                                                Profile
                                            </Link>
                                        )}
                                        {!isPathActive('/settings') && (
                                            <Link
                                                to="/settings"
                                                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/10"
                                            >
                                                Settings
                                            </Link>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                logout();
                                                setIsMobileAccountOpen(false);
                                            }}
                                            className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-red-300 hover:bg-red-500/15"
                                        >
                                            Sign Out
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <Link
                                to={mobileProfilePath}
                                className={mobileTabClasses(location.pathname === '/login' || location.pathname === '/register')}
                            >
                                <User className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">{mobileProfileLabel}</span>
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </nav>
    );
}
