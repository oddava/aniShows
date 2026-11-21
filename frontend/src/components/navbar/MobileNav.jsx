import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, CalendarDays, Compass, Home, LibraryBig, LogIn } from 'lucide-react';

const MAIN_PATHS = ['/', '/browse', '/schedule', '/list', '/forums', '/profile', '/u', '/settings', '/notifications', '/import'];

/**
 * The phone tab bar (M5): Home, Browse, Schedule, My list and Notifications
 * when signed in; the list is one tap away from everywhere. Account items
 * live behind the avatar in the top bar. Guests get Sign in instead of the
 * last two. Every tab is at least 44 px tall (M3); pages reserve room for
 * the bar (body padding in index.css, M1).
 */
export default function MobileNav({ isAuthenticated, mobileUnreadCount = 0 }) {
    const location = useLocation();
    const path = location.pathname;

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
            <ul className={`mx-auto grid h-[var(--tabbar-h)] max-w-md ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
                {tabs.map(({ to, label, icon: Icon, badge }) => {
                    const active = isActive(to);
                    const name = badge > 0 ? `${label}, ${badge} unread` : label;
                    return (
                        <li key={to} className="flex">
                            <Link
                                to={to}
                                aria-current={active ? 'page' : undefined}
                                aria-label={badge > 0 ? name : undefined}
                                className={`relative flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors [-webkit-tap-highlight-color:transparent] ${active ? 'text-white' : 'text-gray-400 active:text-white'}`}
                            >
                                <span className="relative">
                                    <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
                                    {badge > 0 && (
                                        <span aria-hidden="true" className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-[var(--signature)] px-1 text-center text-[10px] font-bold leading-4 text-[var(--on-signature)]">
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
