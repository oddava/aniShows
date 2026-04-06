import { useState, useEffect, useCallback } from 'react';
import {
    Search, Filter, MoreVertical, Shield, ShieldCheck, ShieldOff,
    UserX, UserCheck, Trash2, ChevronLeft, ChevronRight,
    Mail, Calendar, Clock, CheckCircle2, XCircle
} from 'lucide-react';
import api from '../../api/client';
import logger from '../../utils/logger';
import CustomSelect from '../../components/common/CustomSelect';

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
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mb-4">
                    <XCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Error Loading Users</h3>
                <p className="text-gray-400">{error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">User Management</h1>
                    <p className="text-gray-400 mt-1">View, filter, and manage platform users.</p>
                </div>
            </div>

            {/* Table Controls (Search & Filters) */}
            <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-lg">
                <form onSubmit={handleSearch} className="relative w-full md:w-96 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-purple-400 transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="Search users by name or email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
                    />
                </form>

                <div className="flex w-full md:w-auto gap-3">
                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.is_active}
                            onChange={(nextValue) => setFilters((f) => ({ ...f, is_active: nextValue }))}
                            options={[
                                { value: '', label: 'All Status' },
                                { value: 'true', label: 'Active Only' },
                                { value: 'false', label: 'Banned/Inactive' },
                            ]}
                            startIcon={Filter}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm focus-visible:ring-purple-500/50"
                            ariaLabel="Filter by user status"
                        />
                    </div>

                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.is_staff}
                            onChange={(nextValue) => setFilters((f) => ({ ...f, is_staff: nextValue }))}
                            options={[
                                { value: '', label: 'All Roles' },
                                { value: 'true', label: 'Staff & Admins' },
                                { value: 'false', label: 'Regular Users' },
                            ]}
                            startIcon={Shield}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm focus-visible:ring-purple-500/50"
                            ariaLabel="Filter by user role"
                        />
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl relative min-h-[400px]">
                {loading && (
                    <div className="absolute inset-0 z-10 bg-dark/50 backdrop-blur-sm flex items-center justify-center">
                        <div className="flex flex-col items-center">
                            <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
                            <p className="text-sm font-medium text-purple-400">Loading Users...</p>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                        <thead>
                            <tr className="bg-white/[0.02] border-b border-white/5">
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">User Details</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Status</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Role</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Account Intel</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-sm font-bold text-gray-400 overflow-hidden flex-shrink-0">
                                                {user.avatar ? (
                                                    <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                                ) : (
                                                    user.username.charAt(0).toUpperCase()
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-white group-hover:text-purple-400 transition-colors">
                                                    {user.username}
                                                </span>
                                                <span className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                    <Mail size={10} />
                                                    {user.email}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] tracking-wide uppercase font-bold ${user.is_active
                                            ? 'border border-emerald-500/20 text-emerald-400'
                                            : 'border border-red-500/20 text-red-400'
                                            }`}>
                                            {user.is_active ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                            {user.is_active ? 'Active' : 'Banned'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1.5 items-start">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] tracking-wide uppercase font-bold ${user.is_superuser
                                                ? 'border border-amber-500/30 text-amber-400'
                                                : user.is_staff
                                                    ? 'border border-blue-500/30 text-blue-400'
                                                    : 'border border-white/10 text-gray-400'
                                                }`}>
                                                {user.is_superuser ? <Shield size={12} /> : user.is_staff ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
                                                {user.is_superuser ? 'Superadmin' : user.is_staff ? 'Staff' : 'User'}
                                            </span>
                                            {user.email_verified && (
                                                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-500/70 border border-emerald-500/20 px-1.5 rounded">Verified Email</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1 text-xs text-gray-400">
                                            <div className="flex items-center gap-2" title="Date Joined">
                                                <Calendar size={12} className="text-gray-500" />
                                                {new Date(user.date_joined).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-2" title="Last Login">
                                                <Clock size={12} className="text-gray-500" />
                                                {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => toggleUserActive(user.id)}
                                                disabled={user.is_superuser}
                                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed group/btn"
                                                title={user.is_active ? 'Ban User' : 'Unban User'}
                                            >
                                                {user.is_active ? <UserX size={16} className="group-hover/btn:text-red-400" /> : <UserCheck size={16} className="group-hover/btn:text-emerald-400" />}
                                            </button>

                                            <button
                                                onClick={() => toggleUserStaff(user.id)}
                                                disabled={user.is_superuser}
                                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed group/btn"
                                                title={user.is_staff ? 'Remove Staff Role' : 'Promote to Staff'}
                                            >
                                                {user.is_staff ? <ShieldOff size={16} className="group-hover/btn:text-orange-400" /> : <Shield size={16} className="group-hover/btn:text-blue-400" />}
                                            </button>

                                            <button
                                                onClick={() => deleteUser(user.id, user.username)}
                                                disabled={user.is_superuser}
                                                className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                title="Delete User"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {users.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search size={32} className="opacity-20 mb-2" />
                                            <p className="text-sm">No users found matching your criteria.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <span className="text-sm text-gray-400">
                            Showing page <span className="font-semibold text-white">{page}</span> of <span className="font-semibold text-white">{totalPages}</span>
                        </span>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                <ChevronLeft size={16} /> Prev
                            </button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                Next <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminUsers;
