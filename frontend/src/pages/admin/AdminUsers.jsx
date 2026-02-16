import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import logger from '../../utils/logger';

const AdminUsers = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [filters, setFilters] = useState({
        is_staff: '',
        is_active: '',
        ordering: '-date_joined',
    });

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page,
                ...(search && { search }),
                ...(filters.is_staff && { is_staff: filters.is_staff }),
                ...(filters.is_active && { is_active: filters.is_active }),
                ordering: filters.ordering,
            });

            const response = await api.get(`/admin/users/?${params}`);
            setUsers(response.data.results);
            setTotalPages(Math.ceil(response.data.count / 20));
        } catch (err) {
            logger.error('Failed to fetch users:', err);
            setError(err.response?.data?.detail || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }, [page, search, filters]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(1);
        fetchUsers();
    };

    const toggleUserActive = async (userId) => {
        try {
            await api.post(`/admin/users/${userId}/toggle_active/`);
            fetchUsers();
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to toggle user status');
        }
    };

    const toggleUserStaff = async (userId) => {
        try {
            await api.post(`/admin/users/${userId}/toggle_staff/`);
            fetchUsers();
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to toggle staff status');
        }
    };

    const deleteUser = async (userId, username) => {
        if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
            return;
        }
        try {
            await api.delete(`/admin/users/${userId}/`);
            fetchUsers();
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to delete user');
        }
    };

    if (error && !loading) {
        return (
            <div className="admin-empty">
                <div className="admin-empty-icon">⚠️</div>
                <h3 className="admin-empty-title">Error</h3>
                <p className="admin-empty-text">{error}</p>
            </div>
        );
    }

    return (
        <div>
            <h1 className="admin-page-title" style={{ marginBottom: '1.5rem' }}>
                User Management
            </h1>

            <div className="admin-table-container">
                <div className="admin-table-header">
                    <div className="admin-table-actions" style={{ width: '100%', justifyContent: 'space-between' }}>
                        <form onSubmit={handleSearch} className="admin-search">
                            <span className="admin-search-icon">🔍</span>
                            <input
                                type="text"
                                placeholder="Search users..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </form>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <select
                                value={filters.is_active}
                                onChange={(e) => setFilters(f => ({ ...f, is_active: e.target.value }))}
                                className="admin-btn admin-btn-secondary"
                                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(30,30,30,0.8)' }}
                            >
                                <option value="">All Status</option>
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                            </select>

                            <select
                                value={filters.is_staff}
                                onChange={(e) => setFilters(f => ({ ...f, is_staff: e.target.value }))}
                                className="admin-btn admin-btn-secondary"
                                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(30,30,30,0.8)' }}
                            >
                                <option value="">All Roles</option>
                                <option value="true">Staff</option>
                                <option value="false">Regular</option>
                            </select>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="admin-loading">
                        <div className="admin-spinner"></div>
                        <p>Loading users...</p>
                    </div>
                ) : (
                    <>
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Status</th>
                                    <th>Role</th>
                                    <th>Verified</th>
                                    <th>Joined</th>
                                    <th>Last Login</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user) => (
                                    <tr key={user.id}>
                                        <td>
                                            <div className="admin-table-user">
                                                <div className="admin-table-avatar">
                                                    {user.avatar ? (
                                                        <img src={user.avatar} alt={user.username} />
                                                    ) : (
                                                        user.username.charAt(0).toUpperCase()
                                                    )}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: '500' }}>{user.username}</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
                                                        {user.email}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`admin-badge ${user.is_active ? 'success' : 'danger'}`}>
                                                {user.is_active ? '✓ Active' : '✕ Banned'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`admin-badge ${user.is_superuser ? 'info' : user.is_staff ? 'warning' : 'neutral'}`}>
                                                {user.is_superuser ? '👑 Super' : user.is_staff ? '⚙️ Staff' : '👤 User'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`admin-badge ${user.email_verified ? 'success' : 'neutral'}`}>
                                                {user.email_verified ? '✓' : '✕'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                                            {new Date(user.date_joined).toLocaleDateString()}
                                        </td>
                                        <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                                            {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <button
                                                    onClick={() => toggleUserActive(user.id)}
                                                    className="admin-btn admin-btn-icon"
                                                    title={user.is_active ? 'Ban User' : 'Unban User'}
                                                    disabled={user.is_superuser}
                                                >
                                                    {user.is_active ? '🚫' : '✅'}
                                                </button>
                                                <button
                                                    onClick={() => toggleUserStaff(user.id)}
                                                    className="admin-btn admin-btn-icon"
                                                    title={user.is_staff ? 'Remove Staff' : 'Make Staff'}
                                                    disabled={user.is_superuser}
                                                >
                                                    {user.is_staff ? '👤' : '⚙️'}
                                                </button>
                                                <button
                                                    onClick={() => deleteUser(user.id, user.username)}
                                                    className="admin-btn admin-btn-icon"
                                                    title="Delete User"
                                                    disabled={user.is_superuser}
                                                    style={{ color: user.is_superuser ? 'rgba(255,255,255,0.2)' : '#ef4444' }}
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'rgba(255,255,255,0.4)' }}>
                                            No users found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        {totalPages > 1 && (
                            <div className="admin-pagination">
                                <div className="admin-pagination-info">
                                    Page {page} of {totalPages}
                                </div>
                                <div className="admin-pagination-buttons">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="admin-btn admin-btn-secondary"
                                        style={{ padding: '0.4rem 0.75rem' }}
                                    >
                                        ← Prev
                                    </button>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={page === totalPages}
                                        className="admin-btn admin-btn-secondary"
                                        style={{ padding: '0.4rem 0.75rem' }}
                                    >
                                        Next →
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default AdminUsers;
