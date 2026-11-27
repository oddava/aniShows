import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, LayoutDashboard, Search } from 'lucide-react';

import Logo from '../Logo';
import { useAuth } from '../../context/AuthContext';

// Sections reachable from the bottom bar; anywhere else gets a back button.
const TOP_LEVEL_PATHS = ['/', '/browse', '/schedule', '/list', '/forums', '/notifications', '/settings', '/login', '/register'];

/**
 * Phone-only top bar: the wordmark (or Back on detail pages), search and,
 * when signed in, the avatar: one tap to your own profile from any page
 * (the tab bar has no profile tab).
 * Transparent at the top of the page so hero art shows through, a glass bar
 * once scrolled; it slides away while scrolling down and returns on scroll up.
 */
export default function MobileTopBar() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    const isStaff = Boolean(user?.is_staff || user?.is_superuser);
    const [scrolled, setScrolled] = useState(false);
    const [hidden, setHidden] = useState(false);
    // Sticky bars further down (the profile tabs) sit under the bar while it shows.
    useEffect(() => {
        document.documentElement.dataset.mobileNav = hidden ? 'hidden' : 'shown';
    }, [hidden]);
    const lastY = useRef(0);

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY;
            setScrolled(y > 8);
            if (y < 80) setHidden(false);
            else if (y > lastY.current + 4) setHidden(true);
            else if (y < lastY.current - 4) setHidden(false);
            lastY.current = y;
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        setHidden(false);
    }, [location.pathname]);

    const path = location.pathname.replace(/\/+$/, '') || '/';
    // Profiles are reached from the avatar here: no back arrow there either.
    const isTopLevel = TOP_LEVEL_PATHS.includes(path) || /^\/u\/[^/]+(\/[^/]+)?$/.test(path);
    // Browse has its own search box at the top of the page.
    const showSearch = path !== '/browse';
    const profilePath = user?.username ? `/u/${encodeURIComponent(user.username)}` : null;
    const isOwnProfile = Boolean(
        profilePath && (path === profilePath || path.startsWith(`${profilePath}/`)
            || path.toLowerCase() === profilePath.toLowerCase()),
    );
    // Over artwork (top of the page) the icon buttons get a dark backing so
    // they stay legible on bright banners.
    const iconButtonClasses = `press w-11 h-11 flex items-center justify-center rounded-full text-gray-100 transition-colors ${scrolled ? 'hover:bg-white/10' : 'bg-[rgb(21_24_29/0.6)] backdrop-blur-sm hover:bg-[rgb(21_24_29/0.8)]'}`;

    const goBack = () => {
        // location.key is "default" on the first entry of a session: nothing to go back to.
        if (location.key !== 'default') navigate(-1);
        else navigate('/');
    };

    return (
        <header
            onFocus={() => setHidden(false)}
            className={`md:hidden fixed inset-x-0 top-0 z-[1000] pt-[env(safe-area-inset-top)] transition-[translate,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${hidden ? '-translate-y-full' : 'translate-y-0'} ${scrolled ? 'bg-dark/80 backdrop-blur-xl' : 'bg-gradient-to-b from-black/50 to-transparent'}`}
        >
            <div className="h-14 px-2 flex items-center justify-between">
                <div className="flex items-center min-w-0">
                    {!isTopLevel && (
                        <button
                            type="button"
                            onClick={goBack}
                            aria-label="Go back"
                            className={`${iconButtonClasses} mr-1`}
                        >
                            <ChevronLeft aria-hidden="true" className="w-6 h-6" />
                        </button>
                    )}
                    <Link to="/" className={`rounded-md ${isTopLevel ? 'px-2' : 'px-1'}`} aria-label="AniShows home">
                        <Logo textClassName="text-lg font-bold text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.45)]" />
                    </Link>
                </div>
                <div className="flex items-center">
                    {isStaff && (
                        <Link to="/admin" aria-label="Admin" title="Admin" className={iconButtonClasses}>
                            <LayoutDashboard aria-hidden="true" className="w-5 h-5" />
                        </Link>
                    )}
                    {showSearch && (
                        <button
                            type="button"
                            onClick={() => navigate('/browse', { state: { focusSearch: true } })}
                            aria-label="Search anime"
                            className={iconButtonClasses}
                        >
                            <Search aria-hidden="true" className="w-5 h-5" />
                        </button>
                    )}
                    {isAuthenticated && user?.username && (
                        <Link
                            to={profilePath}
                            aria-label={`Your profile (${user.username})`}
                            aria-current={isOwnProfile ? 'page' : undefined}
                            className={`${iconButtonClasses} ml-0.5`}
                        >
                            <span
                                aria-hidden="true"
                                className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--signature-soft)] ${isOwnProfile ? 'ring-2 ring-[var(--signature)]' : 'ring-1 ring-white/15'}`}
                            >
                                {user.avatar ? (
                                    <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-sm font-semibold uppercase text-[var(--signature)]">
                                        {user.username.charAt(0)}
                                    </span>
                                )}
                            </span>
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
}
