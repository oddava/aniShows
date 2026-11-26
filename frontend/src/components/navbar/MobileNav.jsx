import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarDays, Compass, Home, LibraryBig, LogIn } from 'lucide-react';
import useActivePill from '../../hooks/useActivePill';
import usePendingPath from '../../hooks/usePendingPath';

const PILL_TARGET = '[aria-current="page"] > .tab-icon';

const MAIN_PATHS = ['/', '/browse', '/schedule', '/list', '/forums', '/profile', '/u', '/settings', '/notifications', '/import'];

/**
 * The phone tab bar (M5): Home, Browse, Schedule, My list and Notifications
 * when signed in; the list is one tap away from everywhere. Account items
 * live behind the avatar in the top bar. Guests get Sign in instead of the
 * last two. Every tab is at least 44 px tall (M3); pages reserve room for
 * the bar (body padding in index.css, M1).
 */
export default function MobileNav({ isAuthenticated, mobileUnreadCount = 0 }) {
    // The address, not the router's location: the tab answers the tap at
    // once, even while the next page is still loading.
    const path = usePendingPath();
    const pill = useActivePill(PILL_TARGET);

    const show = useMemo(() => MAIN_PATHS.some((item) => (
        item === '/' ? path === '/' : path === item || path.startsWith(`${item}/`)
    )), [path]);

    if (!show) return null;

    const isActive = (to) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

    const tabs = isAuthenticated
        ? [
            { to: '/', label: 'Home', icon: Home },
            { to: '/browse', label: 'Browse', icon: Compass },
            { to: '/schedule', label: 'Schedule', icon: CalendarDays },
            { to: '/list', label: 'My list', icon: LibraryBig },
            { to: '/notifications', label: 'Alerts', icon: Bell, badge: mobileUnreadCount },
        ]
        : [
            { to: '/', label: 'Home', icon: Home },
            { to: '/browse', label: 'Browse', icon: Compass },
            { to: '/schedule', label: 'Schedule', icon: CalendarDays },
            { to: '/login', label: 'Sign in', icon: LogIn },
        ];

    return (
        <nav
            aria-label="Primary"
            className="md:hidden fixed inset-x-0 bottom-0 z-[1001] bg-[rgb(14_16_20/0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl select-none"
        >
            <ul
                ref={pill.hostRef}
                className={`pill-host mx-auto grid h-[var(--tabbar-h)] max-w-md ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}
                style={{ '--pill-radius': '999px', '--pill-bg': 'rgb(141 177 255 / 0.16)' }}
            >
                <li ref={pill.pillRef} aria-hidden="true" role="presentation" className="active-pill" />
                {tabs.map(({ to, label, icon: Icon, badge }) => {
                    const active = isActive(to);
                    const name = badge > 0 ? `${label}, ${badge} unread` : label;
                    return (
                        <li key={to} className="flex">
                            <Link
                                to={to}
                                aria-current={active ? 'page' : undefined}
                                aria-label={badge > 0 ? name : undefined}
                                className={`relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors [-webkit-tap-highlight-color:transparent] ${active ? 'text-white' : 'text-gray-400 active:text-white'}`}
                            >
                                <span className="tab-icon relative flex h-8 w-14 items-center justify-center rounded-full">
                                    <Icon aria-hidden="true" className={`h-5 w-5 transition-colors duration-200 ${active ? 'text-[var(--signature)]' : ''}`} strokeWidth={active ? 2.2 : 1.8} />
                                    {badge > 0 && (
                                        <span aria-hidden="true" className="absolute right-2 -top-1 min-w-[16px] rounded-full bg-[var(--signature)] px-1 text-center text-[10px] font-bold leading-4 text-[var(--on-signature)]">
                                            {badge > 9 ? '9+' : badge}
                                        </span>
                                    )}
                                </span>
                                <span>{label}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
