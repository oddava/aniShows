import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../admin.css';

const AdminLayout = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const navSections = [
        {
            title: 'Overview',
            items: [
                { path: '/admin', icon: '📊', label: 'Dashboard', exact: true },
                { path: '/admin/reports', icon: '📈', label: 'Reports & Analytics' },
            ]
        },
        {
            title: 'Content',
            items: [
                { path: '/admin/anime', icon: '🎬', label: 'Anime' },
                { path: '/admin/genres', icon: '🏷️', label: 'Genres' },
                { path: '/admin/studios', icon: '🏢', label: 'Studios' },
                { path: '/admin/characters', icon: '👤', label: 'Characters' },
                { path: '/admin/staff', icon: '🎙️', label: 'Staff' },
            ]
        },
        {
            title: 'Users',
            items: [
                { path: '/admin/users', icon: '👥', label: 'All Users' },
                { path: '/admin/user-lists', icon: '📋', label: 'List Entries' },
                { path: '/admin/favorites', icon: '❤️', label: 'Favorites' },
                { path: '/admin/import-jobs', icon: '📥', label: 'Import Jobs' },
            ]
        },
        {
            title: 'Moderation',
            items: [
                { path: '/admin/reviews', icon: '⭐', label: 'Reviews' },
                { path: '/admin/review-reports', icon: '🚨', label: 'Review Reports' },
            ]
        },
        {
            title: 'System',
            items: [
                { path: '/admin/settings', icon: '⚙️', label: 'Settings' },
                { path: '/admin/logs', icon: '📜', label: 'Logs' },
            ]
        },
    ];

    return (
        <div className="admin-layout">
            {/* Sidebar */}
            <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
                <div className="admin-sidebar-header">
                    <NavLink to="/admin" className="admin-brand">
                        <svg
                            viewBox="0 0 120 120"
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-8 h-8"
                        >
                            <defs>
                                <linearGradient id="adminNeonPurple" x1="0%" y1="100%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#7B1FA2" />
                                    <stop offset="50%" stopColor="#B388FF" />
                                    <stop offset="100%" stopColor="#EA80FC" />
                                </linearGradient>

                                <linearGradient id="adminDarkPurple" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#4A148C" />
                                    <stop offset="100%" stopColor="#210F40" />
                                </linearGradient>
                            </defs>

                            <g transform="translate(10, 5)">
                                <path d="M48 25 L22 85 L42 85 L68 25 Z" fill="url(#adminDarkPurple)" />

                                <path d="M48 25 L88 85 L68 85 L36 40 Z" fill="url(#adminNeonPurple)" />

                                <rect x="30" y="62" width="45" height="8" rx="4" fill="#311B92" />
                                <rect x="30" y="62" width="28" height="8" rx="4" fill="#EA80FC" />
                            </g>
                        </svg>
                        <span>aniShows Admin</span>
                    </NavLink>
                </div>

                <nav className="admin-nav">
                    {navSections.map((section) => (
                        <div key={section.title} className="admin-nav-section">
                            <div className="admin-nav-title">{section.title}</div>
                            {section.items.map((item) => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    end={item.exact}
                                    className={({ isActive }) =>
                                        `admin-nav-link ${isActive ? 'active' : ''}`
                                    }
                                    onClick={() => setSidebarOpen(false)}
                                >
                                    <span className="admin-nav-icon">{item.icon}</span>
                                    <span>{item.label}</span>
                                </NavLink>
                            ))}
                        </div>
                    ))}

                    <div className="admin-nav-section">
                        <div className="admin-nav-title">Quick Links</div>
                        <NavLink to="/" className="admin-nav-link" onClick={() => setSidebarOpen(false)}>
                            <span className="admin-nav-icon">🏠</span>
                            <span>Back to Site</span>
                        </NavLink>
                        <button onClick={handleLogout} className="admin-nav-link" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                            <span className="admin-nav-icon">🚪</span>
                            <span>Logout</span>
                        </button>
                    </div>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="admin-main">
                <header className="admin-header">
                    <div className="admin-header-left">
                        <button
                            className="admin-mobile-toggle"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                        >
                            ☰
                        </button>
                    </div>
                    <div className="admin-header-right">
                        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>
                            Welcome, <strong style={{ color: '#a78bfa' }}>{user?.username}</strong>
                        </span>
                    </div>
                </header>

                <div className="admin-content">
                    <Outlet />
                </div>
            </main>

            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.5)',
                        zIndex: 40,
                    }}
                    onClick={() => setSidebarOpen(false)}
                />
            )}
        </div>
    );
};

export default AdminLayout;
