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
                        <span className="admin-brand-icon">🛡️</span>
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
