import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import logger from '../../utils/logger';

const AdminDashboard = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchDashboardStats();
    }, []);

    const fetchDashboardStats = async () => {
        try {
            const response = await api.get('/admin/dashboard/');
            setStats(response.data);
        } catch (err) {
            logger.error('Failed to fetch dashboard stats:', err);
            setError(err.response?.data?.detail || 'Failed to load dashboard');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="admin-loading">
                <div className="admin-spinner"></div>
                <p>Loading dashboard...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="admin-empty">
                <div className="admin-empty-icon">⚠️</div>
                <h3 className="admin-empty-title">Access Denied</h3>
                <p className="admin-empty-text">{error}</p>
            </div>
        );
    }

    const statCards = [
        {
            label: 'Total Users',
            value: stats?.statistics?.users?.total || 0,
            change: `+${stats?.statistics?.users?.new_7d || 0} this week`,
            icon: '👥',
            color: 'purple',
        },
        {
            label: 'Total Anime',
            value: stats?.statistics?.content?.total_anime || 0,
            change: `${stats?.statistics?.content?.airing_anime || 0} airing`,
            icon: '🎬',
            color: 'blue',
        },
        {
            label: 'Total Reviews',
            value: stats?.statistics?.content?.total_reviews || 0,
            change: `+${stats?.statistics?.content?.new_reviews_7d || 0} this week`,
            icon: '⭐',
            color: 'orange',
        },
        {
            label: 'Favorites',
            value: stats?.statistics?.engagement?.total_favorites || 0,
            change: 'All time',
            icon: '❤️',
            color: 'pink',
        },
        {
            label: 'List Entries',
            value: stats?.statistics?.engagement?.total_list_entries || 0,
            change: 'User anime lists',
            icon: '📋',
            color: 'cyan',
        },
        {
            label: 'Verified Users',
            value: stats?.statistics?.users?.verified || 0,
            change: `of ${stats?.statistics?.users?.total || 0} total`,
            icon: '✅',
            color: 'green',
        },
    ];

    return (
        <div>
            <h1 className="admin-page-title" style={{ marginBottom: '1.5rem' }}>
                Dashboard Overview
            </h1>

            {/* Stats Grid */}
            <div className="admin-stats-grid">
                {statCards.map((stat, index) => (
                    <div key={index} className={`admin-stat-card ${stat.color}`}>
                        <div className="admin-stat-header">
                            <div className="admin-stat-icon">{stat.icon}</div>
                            <span className="admin-stat-change positive">{stat.change}</span>
                        </div>
                        <div className="admin-stat-value">{stat.value.toLocaleString()}</div>
                        <div className="admin-stat-label">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Charts and Activity */}
            <div className="admin-grid-2" style={{ marginBottom: '1.5rem' }}>
                {/* User Growth Chart */}
                <div className="admin-chart-card">
                    <div className="admin-chart-header">
                        <h3 className="admin-chart-title">📈 User Growth (30 days)</h3>
                        <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                            +{stats?.statistics?.users?.new_30d || 0} new
                        </span>
                    </div>
                    <div style={{ height: '200px', display: 'flex', alignItems: 'flex-end', gap: '4px', padding: '0 0.5rem', overflowX: 'auto' }}>
                        {stats?.charts?.user_growth && stats.charts.user_growth.length > 0 ? (
                            stats.charts.user_growth.map((item, index) => {
                                const maxCount = Math.max(...stats.charts.user_growth.map(d => d.count), 1);
                                const height = (item.count / maxCount) * 160;
                                return (
                                    <div
                                        key={index}
                                        style={{
                                            flex: 1,
                                            minWidth: '8px',
                                            height: `${Math.max(height, 4)}px`,
                                            background: 'linear-gradient(180deg, #8b5cf6 0%, #6366f1 100%)',
                                            borderRadius: '4px 4px 0 0',
                                            transition: 'height 0.3s ease',
                                        }}
                                        title={`${item.date}: ${item.count} new users`}
                                    />
                                );
                            })
                        ) : (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'rgba(255,255,255,0.4)',
                                height: '100%'
                            }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
                                <div style={{ fontSize: '0.9rem' }}>No signups in the last 30 days</div>
                                <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', color: 'rgba(255,255,255,0.3)' }}>
                                    Total users: {stats?.statistics?.users?.total || 0}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Popular Anime */}
                <div className="admin-chart-card">
                    <div className="admin-chart-header">
                        <h3 className="admin-chart-title">🔥 Popular Anime</h3>
                        <Link to="/admin/anime" className="admin-btn admin-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
                            View All
                        </Link>
                    </div>
                    <div className="admin-activity-list">
                        {stats?.popular_anime?.slice(0, 5).map((anime, index) => (
                            <div key={anime.id} className="admin-activity-item">
                                <div
                                    className="admin-activity-icon"
                                    style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', fontSize: '1rem', fontWeight: '700' }}
                                >
                                    #{index + 1}
                                </div>
                                <div className="admin-activity-content">
                                    <div className="admin-activity-text" style={{ fontWeight: '500' }}>
                                        {anime.title}
                                    </div>
                                    <div className="admin-activity-time">
                                        ❤️ {anime.favorite_count} favorites
                                    </div>
                                </div>
                            </div>
                        ))}
                        {(!stats?.popular_anime || stats.popular_anime.length === 0) && (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                                No anime data available
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Recent Activity */}
            <div className="admin-grid-2">
                {/* Recent Users */}
                <div className="admin-table-container">
                    <div className="admin-table-header">
                        <h3 className="admin-table-title">👤 Recent Users</h3>
                        <Link to="/admin/users" className="admin-btn admin-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
                            View All
                        </Link>
                    </div>
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Status</th>
                                <th>Joined</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats?.recent_users?.map((user) => (
                                <tr key={user.id}>
                                    <td>
                                        <div className="admin-table-user">
                                            <div className="admin-table-avatar">
                                                {user.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: '500' }}>{user.username}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`admin-badge ${user.is_active ? 'success' : 'danger'}`}>
                                            {user.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                                        {new Date(user.date_joined).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Recent Reviews */}
                <div className="admin-table-container">
                    <div className="admin-table-header">
                        <h3 className="admin-table-title">⭐ Recent Reviews</h3>
                        <Link to="/admin/reviews" className="admin-btn admin-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
                            View All
                        </Link>
                    </div>
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Anime</th>
                                <th>Rating</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats?.recent_reviews?.map((review) => (
                                <tr key={review.id}>
                                    <td style={{ fontWeight: '500' }}>{review.user}</td>
                                    <td style={{ color: 'rgba(255,255,255,0.7)' }}>
                                        {review.anime.length > 20 ? review.anime.substring(0, 20) + '...' : review.anime}
                                    </td>
                                    <td>
                                        <span className={`admin-badge ${review.rating >= 7 ? 'success' : review.rating >= 4 ? 'warning' : 'danger'}`}>
                                            ⭐ {review.rating}/10
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {(!stats?.recent_reviews || stats.recent_reviews.length === 0) && (
                                <tr>
                                    <td colSpan="3" style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                                        No recent reviews
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
