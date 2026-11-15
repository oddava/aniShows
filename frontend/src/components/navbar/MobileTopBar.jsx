import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';

import Logo from '../Logo';

// Sections reachable from the bottom bar; anywhere else gets a back button.
const TOP_LEVEL_PATHS = ['/', '/browse', '/schedule', '/forums', '/notifications', '/settings', '/login', '/register'];

/**
 * Phone-only top bar: the wordmark (or Back on detail pages) and search.
 * Transparent at the top of the page so hero art shows through, a glass bar
 * once scrolled; it slides away while scrolling down and returns on scroll up.
 */
export default function MobileTopBar() {
    const location = useLocation();
    const navigate = useNavigate();
    const [scrolled, setScrolled] = useState(false);
    const [hidden, setHidden] = useState(false);
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
    const isTopLevel = TOP_LEVEL_PATHS.includes(path);
    // Browse has its own search box at the top of the page.
    const showSearch = path !== '/browse';
    // Over artwork (top of the page) the icon buttons get a dark backing so
    // they stay legible on bright banners.
    const iconButtonClasses = `w-10 h-10 flex items-center justify-center rounded-full text-gray-100 transition-colors ${scrolled ? 'hover:bg-white/10' : 'bg-black/35 backdrop-blur-sm hover:bg-black/50'}`;

    const goBack = () => {
        // location.key is "default" on the first entry of a session: nothing to go back to.
        if (location.key !== 'default') navigate(-1);
        else navigate('/');
    };

    return (
        <header
            onFocus={() => setHidden(false)}
            className={`md:hidden fixed inset-x-0 top-0 z-[1000] pt-[env(safe-area-inset-top)] transition-[transform,background-color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] border-b ${hidden ? '-translate-y-full' : 'translate-y-0'} ${scrolled ? 'bg-dark/80 backdrop-blur-xl border-white/5' : 'bg-gradient-to-b from-black/50 to-transparent border-transparent'}`}
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
            </div>
        </header>
    );
}
