import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, PieChart, Film, Tags, Building2, Users2, Mic,
    Users, Award, UploadCloud, Star, AlertTriangle, Settings, FileText,
    Menu, X, LogOut, Home, Search, ChevronRight, Bell, CheckCheck,
    UserPlus, MessageSquare, ShieldAlert, Tv, Heart, Flag
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notificationApi } from '../api/client';
import logger from '../utils/logger';
import '../admin.css';

const NOTIF_ICON_MAP = {
    new_episode: { icon: Tv, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    review_reply: { icon: MessageSquare, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    new_follower: { icon: UserPlus, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    badge_awarded: { icon: Award, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    system: { icon: ShieldAlert, color: 'text-red-400', bg: 'bg-red-500/10' },
    forum_reply: { icon: MessageSquare, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    forum_mention: { icon: Flag, color: 'text-pink-400', bg: 'bg-pink-500/10' },
    forum_like: { icon: Heart, color: 'text-pink-400', bg: 'bg-pink-500/10' },
};

const AdminNotifications = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    const fetchUnreadCount = useCallback(async () => {
        try {
            const response = await notificationApi.getUnreadCount();
            setUnreadCount(response.data.count);
        } catch (err) {
            logger.error('Failed to fetch notification count:', err);
        }
    }, []);

    useEffect(() => {
        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30000);
        return () => clearInterval(interval);
    }, [fetchUnreadCount]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchNotifications = async () => {
        setLoading(true);
        try {
            const response = await notificationApi.getAll({ is_read: false });
            setNotifications(response.data.results || []);
        } catch (err) {
            logger.error('Failed to fetch notifications:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleBellClick = () => {
        if (!isOpen) fetchNotifications();
        setIsOpen(!isOpen);
    };

    const handleMarkAsRead = async (id, e) => {
        e.stopPropagation();
        try {
            await notificationApi.markAsRead(id);
            setNotifications(prev => prev.filter(n => n.id !== id));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (err) {
            logger.error('Failed to mark notification as read:', err);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            await notificationApi.markAllAsRead();
            setNotifications([]);
            setUnreadCount(0);
        } catch (err) {
            logger.error('Failed to mark all as read:', err);
        }
    };

    const handleNotificationClick = async (notification) => {
        try {
            await notificationApi.markAsRead(notification.id);
            setNotifications(prev => prev.filter(n => n.id !== notification.id));
            setUnreadCount(prev => Math.max(0, prev - 1));
            setIsOpen(false);

            // Navigate to relevant admin page based on type
            const data = notification.data || {};
            if (data.anime_id || data.anime_slug) {
                navigate('/admin/anime');
            } else if (notification.notification_type === 'new_follower') {
                navigate('/admin/users');
            } else if (notification.notification_type === 'review_reply') {
                navigate('/admin/reviews');
            } else if (notification.notification_type === 'badge_awarded') {
                navigate('/admin/badges');
            }
        } catch (err) {
            logger.error('Failed to handle notification click:', err);
        }
    };

    const getNotifMeta = (type) => NOTIF_ICON_MAP[type] || NOTIF_ICON_MAP.system;

    const formatTime = (dateStr) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHrs = Math.floor(diffMin / 60);
        if (diffHrs < 24) return `${diffHrs}h ago`;
        const diffDays = Math.floor(diffHrs / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleBellClick}
                className="relative p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                aria-label="Notifications"
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-purple-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 animate-pulse border-2 border-[#111111]">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
                {unreadCount === 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-gray-600 rounded-full border border-[#111111]" />
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-[#111111]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 z-50 overflow-hidden">
                    {/* Header */}
                    <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold text-white">Notifications</h3>
                            {unreadCount > 0 && (
                                <p className="text-[10px] text-gray-500 mt-0.5">{unreadCount} unread</p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {notifications.length > 0 && (
                                <button
                                    onClick={handleMarkAllAsRead}
                                    className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-purple-500/10"
                                >
                                    <CheckCheck size={14} />
                                    Mark all read
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {loading ? (
                            <div className="py-12 text-center">
                                <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-3" />
                                <p className="text-xs text-gray-500">Loading notifications...</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="py-12 text-center">
                                <Bell size={32} className="mx-auto mb-3 text-gray-700" />
                                <p className="text-sm font-medium text-gray-400">All caught up</p>
                                <p className="text-xs text-gray-600 mt-1">No unread notifications</p>
                            </div>
                        ) : (
                            notifications.slice(0, 10).map((notif) => {
                                const meta = getNotifMeta(notif.notification_type);
                                const IconComp = meta.icon;
                                return (
                                    <div
                                        key={notif.id}
                                        onClick={() => handleNotificationClick(notif)}
                                        className="flex items-start gap-3 px-5 py-3.5 hover:bg-white/[0.03] transition-colors cursor-pointer border-b border-white/[0.03] last:border-0 group"
                                    >
                                        <div className={`w-9 h-9 rounded-xl ${meta.bg} ${meta.color} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                            <IconComp size={16} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-white line-clamp-1">{notif.title}</p>
                                            <p className="text-xs text-gray-400 line-clamp-2 mt-0.5 leading-relaxed">{notif.message}</p>
                                            <p className="text-[10px] text-gray-600 mt-1.5 font-medium">{formatTime(notif.created_at)}</p>
                                        </div>
                                        <button
                                            onClick={(e) => handleMarkAsRead(notif.id, e)}
                                            className="p-1.5 text-gray-600 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                                            title="Mark as read"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                        <div className="px-5 py-3 border-t border-white/5 bg-white/[0.02]">
                            <button
                                onClick={() => { setIsOpen(false); navigate('/admin/logs'); }}
                                className="w-full text-center text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                View all activity
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const AdminLayout = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Close sidebar on mobile when route changes
    useEffect(() => {
        setSidebarOpen(false);
    }, [location]);

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const navSections = [
        {
            title: 'Overview',
            items: [
                { path: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard', exact: true },
                { path: '/admin/reports', icon: <PieChart size={20} />, label: 'Analytics' },
            ]
        },
        {
            title: 'Content',
            items: [
                { path: '/admin/anime', icon: <Film size={20} />, label: 'Anime' },
                { path: '/admin/genres', icon: <Tags size={20} />, label: 'Genres' },
                { path: '/admin/studios', icon: <Building2 size={20} />, label: 'Studios' },
                { path: '/admin/characters', icon: <Users2 size={20} />, label: 'Characters' },
                { path: '/admin/staff', icon: <Mic size={20} />, label: 'Staff' },
            ]
        },
        {
            title: 'Users',
            items: [
                { path: '/admin/users', icon: <Users size={20} />, label: 'All Users' },
                { path: '/admin/badges', icon: <Award size={20} />, label: 'Badges' },
                { path: '/admin/import-jobs', icon: <UploadCloud size={20} />, label: 'Import Jobs' },
            ]
        },
        {
            title: 'Moderation',
            items: [
                { path: '/admin/reviews', icon: <Star size={20} />, label: 'Reviews' },
                { path: '/admin/review-reports', icon: <AlertTriangle size={20} />, label: 'Review Reports' },
            ]
        },
        {
            title: 'System',
            items: [
                { path: '/admin/settings', icon: <Settings size={20} />, label: 'Settings' },
                { path: '/admin/logs', icon: <FileText size={20} />, label: 'Logs' },
                { path: '/django-admin/', icon: <ShieldAlert size={20} />, label: 'Django Admin', external: true },
            ]
        },
    ];

    const currentRouteName = navSections
        .flatMap(s => s.items)
        .find(item => item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path))?.label || 'Dashboard';

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex overflow-hidden">
            {/* Sidebar Background Overlay (Mobile) */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed inset-y-0 left-0 z-50 w-72 bg-[#111111]/95 backdrop-blur-xl border-r border-white/5 
                transform transition-all duration-300 ease-in-out flex flex-col
                lg:translate-x-0 lg:static lg:flex-shrink-0
                ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
            `}>
                {/* Brand Header */}
                <div className="h-20 flex items-center px-6 border-b border-white/5">
                    <NavLink to="/admin" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center transition-all duration-300">
                            <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
                                <defs>
                                    <linearGradient id="adminNeonPurple" x1="0%" y1="100%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#ffffff" />
                                        <stop offset="100%" stopColor="#e9d5ff" />
                                    </linearGradient>
                                </defs>
                                <g transform="translate(10, 5)">
                                    <path d="M48 25 L88 85 L68 85 L36 40 Z" fill="url(#adminNeonPurple)" />
                                    <rect x="30" y="62" width="28" height="8" rx="4" fill="#ffffff" />
                                </g>
                            </svg>
                        </div>
                        <span className="text-xl font-bold text-white">
                            aniShows
                            <span className="text-gray-400 ml-1.5 text-sm font-semibold tracking-wider uppercase">Admin</span>
                        </span>
                    </NavLink>
                </div>

                {/* Navigation Links */}
                <div className="flex-1 overflow-y-auto custom-scrollbar py-6 px-4 space-y-8">
                    {navSections.map((section) => (
                        <div key={section.title}>
                            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                {section.title}
                            </div>
                            <div className="space-y-1">
                                {section.items.map((item) => {
                                    const isActive = !item.external && (item.exact
                                        ? location.pathname === item.path
                                        : location.pathname.startsWith(item.path));

                                    const linkContent = (
                                        <>
                                            {isActive && (
                                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full" />
                                            )}
                                            <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                                                {item.icon}
                                            </span>
                                            {item.label}
                                        </>
                                    );

                                    const commonClasses = `
                                        flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative overflow-hidden
                                        ${isActive
                                            ? 'border border-white/10 text-white bg-white/5'
                                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }
                                    `;

                                    if (item.external) {
                                        return (
                                            <a
                                                key={item.path}
                                                href={item.path}
                                                className={commonClasses}
                                            >
                                                {linkContent}
                                            </a>
                                        );
                                    }

                                    return (
                                        <NavLink
                                            key={item.path}
                                            to={item.path}
                                            end={item.exact}
                                            className={commonClasses}
                                        >
                                            {linkContent}
                                        </NavLink>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Bottom Footer Area */}
                <div className="p-4 border-t border-white/5 space-y-1">
                    <NavLink
                        to="/"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all duration-200"
                    >
                        <Home size={20} />
                        Back to Site
                    </NavLink>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
                    >
                        <LogOut size={20} />
                        Logout
                    </button>

                    {/* User Profile Mini */}
                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-3 px-2">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border border-white/10 text-gray-400">
                            {user?.username?.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-white">{user?.username}</span>
                            <span className="text-xs text-green-400 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                Online
                            </span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                {/* Top App Bar */}
                <header className={`
                    h-20 flex-shrink-0 flex items-center justify-between px-6 lg:px-10 z-30 transition-all duration-300
                    ${scrolled ? 'bg-[#111111]/80 backdrop-blur-xl border-b border-white/5 shadow-lg' : 'bg-transparent'}
                `}>
                    <div className="flex items-center gap-4 flex-1">
                        <button
                            className="lg:hidden p-2 -ml-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                            onClick={() => setSidebarOpen(true)}
                        >
                            <Menu size={24} />
                        </button>

                        {/* Breadcrumbs */}
                        <div className="hidden sm:flex items-center gap-2 text-sm text-gray-400">
                            <span className="hover:text-white cursor-pointer transition-colors">Admin</span>
                            <ChevronRight size={16} className="text-gray-600" />
                            <span className="text-white font-medium">{currentRouteName}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Global Search Mockup */}
                        <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all group focus-within:ring-2 focus-within:ring-purple-500/50 focus-within:border-purple-500 w-64">
                            <Search size={16} className="text-gray-400 group-focus-within:text-purple-400 transition-colors" />
                            <input
                                type="text"
                                placeholder="Search everything..."
                                className="bg-transparent border-none outline-none text-sm text-white focus:ring-0 p-0 w-full placeholder-gray-500"
                            />
                            <div className="hidden lg:flex items-center gap-1 opacity-50">
                                <kbd className="font-sans text-[10px] bg-white/10 px-1.5 py-0.5 rounded border border-white/20">⌘</kbd>
                                <kbd className="font-sans text-[10px] bg-white/10 px-1.5 py-0.5 rounded border border-white/20">K</kbd>
                            </div>
                        </div>

                        {/* Notifications */}
                        <AdminNotifications />
                    </div>
                </header>

                {/* Subpage Router View */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-[#0a0a0a]">
                    <div className="p-6 lg:p-10 max-w-7xl mx-auto w-full min-h-full pb-24">
                        <div className="mb-6 lg:hidden">
                            <h1 className="text-2xl font-bold">{currentRouteName}</h1>
                        </div>
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
