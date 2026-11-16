import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    Activity, Award, Building2, ChevronRight, FileText, Film, Flag, Home, LayoutDashboard,
    LogOut, Menu, Mic, PieChart, Settings, ShieldAlert, Star, Tags, UploadCloud, Users, Users2, X,
} from 'lucide-react';

import { MODERATION_SUMMARY_POLL_MS, adminQueries } from '../api/queries/admin';
import { useAuth } from '../context/AuthContext';
import '../admin.css';

const ICON_SIZE = 20;

/** Sidebar sections. `superuserOnly` items are hidden from staff (the API refuses them). */
export const buildNavSections = ({ isSuperuser }) => [
    {
        title: 'Overview',
        items: [
            { path: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
            { path: '/admin/reports', icon: PieChart, label: 'Analytics' },
        ],
    },
    {
        title: 'Moderation',
        items: [
            { path: '/admin/moderation', icon: Flag, label: 'Queue', badge: 'moderation' },
            { path: '/admin/reviews', icon: Star, label: 'Reviews' },
        ],
    },
    {
        title: 'Users',
        items: [
            { path: '/admin/users', icon: Users, label: 'Users' },
            { path: '/admin/badges', icon: Award, label: 'Badges' },
        ],
    },
    {
        title: 'Catalog',
        items: [
            { path: '/admin/anime', icon: Film, label: 'Anime' },
            { path: '/admin/genres', icon: Tags, label: 'Genres' },
            { path: '/admin/studios', icon: Building2, label: 'Studios' },
            { path: '/admin/characters', icon: Users2, label: 'Characters' },
            { path: '/admin/staff', icon: Mic, label: 'Staff' },
        ],
    },
    {
        title: 'System',
        items: [
            { path: '/admin/system', icon: Activity, label: 'System' },
            { path: '/admin/import-jobs', icon: UploadCloud, label: 'Catalog imports' },
            { path: '/admin/logs', icon: FileText, label: 'Logs', superuserOnly: true },
            { path: '/admin/settings', icon: Settings, label: 'Settings' },
            { path: '/django-admin/', icon: ShieldAlert, label: 'Django admin', external: true },
        ],
    },
].map((section) => ({
    ...section,
    items: section.items.filter((item) => isSuperuser || !item.superuserOnly),
}));

const isActivePath = (item, pathname) => !item.external && (item.exact
    ? pathname === item.path
    : pathname === item.path || pathname.startsWith(`${item.path}/`));

/** Open review reports (+ forum reports once G5 ships them), polled in the foreground. */
function useModerationCount() {
    const { data } = useQuery({
        ...adminQueries.moderationSummary(),
        refetchInterval: MODERATION_SUMMARY_POLL_MS,
        refetchIntervalInBackground: false,
        retry: false,
    });
    if (!data) return 0;
    return (data.open_reviews || 0) + (data.forums?.open || 0);
}

const AdminLayout = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const toggleRef = useRef(null);
    const moderationCount = useModerationCount();

    const closeSidebar = useCallback(({ restoreFocus = true } = {}) => {
        setSidebarOpen(false);
        if (restoreFocus) toggleRef.current?.focus();
    }, []);

    // Close the phone sidebar on navigation (focus stays on the new page).
    useEffect(() => {
        setSidebarOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!sidebarOpen) return undefined;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') closeSidebar();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [sidebarOpen, closeSidebar]);

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const navSections = buildNavSections({ isSuperuser: Boolean(user?.is_superuser) });
    const currentRouteName = navSections
        .flatMap((s) => s.items)
        .find((item) => isActivePath(item, location.pathname))?.label || 'Dashboard';

    const linkClasses = (isActive) => `
        flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors relative
        ${isActive ? 'border border-white/10 text-white bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}
    `;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex overflow-hidden">
            {sidebarOpen && (
                <div
                    aria-hidden="true"
                    className="fixed inset-0 bg-black/60 z-40 lg:hidden"
                    onClick={() => closeSidebar()}
                />
            )}

            <aside
                id="admin-sidebar"
                aria-label="Admin navigation"
                className={`
                    fixed inset-y-0 left-0 z-50 w-72 bg-dark border-r border-white/5
                    transform transition-transform duration-300 ease-in-out flex flex-col
                    lg:translate-x-0 lg:static lg:flex-shrink-0 motion-reduce:transition-none
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            >
                <div className="h-20 flex items-center justify-between px-6 border-b border-white/5">
                    <NavLink to="/admin" className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center">
                            <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" aria-hidden="true">
                                <g transform="translate(10, 5)">
                                    <path d="M48 25 L88 85 L68 85 L36 40 Z" fill="#ffffff" />
                                    <rect x="30" y="62" width="28" height="8" rx="4" fill="#ffffff" />
                                </g>
                            </svg>
                        </div>
                        <span className="text-xl font-bold text-white">
                            aniShows
                            <span className="text-gray-400 ml-1.5 text-sm font-semibold tracking-wider uppercase">Admin</span>
                        </span>
                    </NavLink>
                    <button
                        type="button"
                        className="lg:hidden w-11 h-11 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 rounded-lg"
                        onClick={() => closeSidebar()}
                        aria-label="Close navigation"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto custom-scrollbar py-6 px-4 space-y-8">
                    {navSections.map((section) => (
                        <div key={section.title}>
                            <h2 className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                {section.title}
                            </h2>
                            <ul className="space-y-1">
                                {section.items.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = isActivePath(item, location.pathname);
                                    const badgeCount = item.badge === 'moderation' ? moderationCount : 0;
                                    const content = (
                                        <>
                                            {isActive && (
                                                <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full" />
                                            )}
                                            <Icon size={ICON_SIZE} aria-hidden="true" />
                                            <span className="flex-1">{item.label}</span>
                                            {badgeCount > 0 && (
                                                <span
                                                    className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#7c3aed] text-white text-[11px] font-semibold flex items-center justify-center"
                                                    aria-label={`${badgeCount} open`}
                                                >
                                                    {badgeCount > 99 ? '99+' : badgeCount}
                                                </span>
                                            )}
                                        </>
                                    );
                                    return (
                                        <li key={item.path}>
                                            {item.external ? (
                                                <a href={item.path} className={linkClasses(false)}>{content}</a>
                                            ) : (
                                                <NavLink
                                                    to={item.path}
                                                    end={item.exact}
                                                    aria-current={isActive ? 'page' : undefined}
                                                    className={linkClasses(isActive)}
                                                >
                                                    {content}
                                                </NavLink>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </nav>

                <div className="p-4 border-t border-white/5 space-y-1">
                    <NavLink to="/" className={linkClasses(false)}>
                        <Home size={ICON_SIZE} aria-hidden="true" />
                        Back to Site
                    </NavLink>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-xl text-sm font-medium text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                        <LogOut size={ICON_SIZE} aria-hidden="true" />
                        Logout
                    </button>

                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-3 px-2">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border border-white/10 text-gray-400" aria-hidden="true">
                            {user?.username?.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-white">{user?.username}</span>
                            <span className="text-xs text-gray-500">{user?.is_superuser ? 'Superuser' : 'Staff'}</span>
                        </div>
                    </div>
                </div>
            </aside>

            <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                <header className="h-16 lg:h-20 flex-shrink-0 flex items-center px-4 sm:px-6 lg:px-10 border-b border-white/5 bg-dark">
                    <div className="flex items-center gap-4 flex-1">
                        <button
                            ref={toggleRef}
                            type="button"
                            className="lg:hidden w-11 h-11 -ml-2 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                            onClick={() => setSidebarOpen((open) => !open)}
                            aria-expanded={sidebarOpen}
                            aria-controls="admin-sidebar"
                            aria-label="Admin navigation"
                        >
                            <Menu size={24} aria-hidden="true" />
                        </button>

                        <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-2 text-sm text-gray-400">
                            <span>Admin</span>
                            <ChevronRight size={16} className="text-gray-600" aria-hidden="true" />
                            <span className="text-white font-medium" aria-current="page">{currentRouteName}</span>
                        </nav>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-dark">
                    <div className="px-4 py-6 sm:p-6 lg:p-10 max-w-7xl mx-auto w-full min-h-full pb-24">
                        <div className="mb-6 sm:hidden">
                            <p className="text-sm text-gray-400">{currentRouteName}</p>
                        </div>
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
