import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Users, Film, Star, Heart, CheckCircle,
    TrendingUp, ExternalLink, Activity, ArrowUpRight, ArrowDownRight,
    UsersRound, ShieldCheck, Clock, ChevronRight
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';
import api from '../../api/client';
import logger from '../../utils/logger';

// Custom Tooltip for Recharts
const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-[#1a1a1a]/90 backdrop-blur-xl border border-white/10 p-3 rounded-xl shadow-2xl">
                <p className="text-gray-400 text-xs mb-1 mb-2 font-medium">{label}</p>
                <p className="text-white text-sm font-bold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                    {payload[0].value} New Users
                </p>
            </div>
        );
    }
    return null;
};

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
            setError(err.response?.data?.detail || 'Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-400">
                <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin mb-4" />
                <p className="font-medium animate-pulse">Loading dashboard telemetry...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mb-4">
                    <ShieldCheck size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Access Denied</h3>
                <p className="text-gray-400">{error}</p>
            </div>
        );
    }

    const statCards = [
        {
            label: 'Total Users',
            value: stats?.statistics?.users?.total || 0,
            change: `+${stats?.statistics?.users?.new_7d || 0}`,
            subtext: 'this week',
            trend: 'up',
            icon: Users,
            color: 'from-purple-600 to-indigo-600',
            bg: 'bg-purple-500/10',
            textColor: 'text-purple-400',
        },
        {
            label: 'Total Anime',
            value: stats?.statistics?.content?.total_anime || 0,
            change: stats?.statistics?.content?.airing_anime || 0,
            subtext: 'currently airing',
            trend: 'none',
            icon: Film,
            color: 'from-blue-600 to-cyan-600',
            bg: 'bg-blue-500/10',
            textColor: 'text-blue-400',
        },
        {
            label: 'Total Reviews',
            value: stats?.statistics?.content?.total_reviews || 0,
            change: `+${stats?.statistics?.content?.new_reviews_7d || 0}`,
            subtext: 'this week',
            trend: 'up',
            icon: Star,
            color: 'from-amber-500 to-orange-600',
            bg: 'bg-amber-500/10',
            textColor: 'text-amber-400',
        },
        {
            label: 'Verified Users',
            value: stats?.statistics?.users?.verified || 0,
            change: `${Math.round(((stats?.statistics?.users?.verified || 0) / (stats?.statistics?.users?.total || 1)) * 100)}%`,
            subtext: 'of total users',
            trend: 'none',
            icon: CheckCircle,
            color: 'from-emerald-500 to-teal-600',
            bg: 'bg-emerald-500/10',
            textColor: 'text-emerald-400',
        },
    ];

    // Format chart data for Recharts
    const chartData = stats?.charts?.user_growth?.map(item => ({
        name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        Users: item.count
    })) || [];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-2">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard Overview</h1>
                    <p className="text-gray-400 mt-1">Here's what's happening with your platform today.</p>
                </div>
                <div className="flex gap-3">
                    <button className="flex items-center gap-2 px-4 py-2 border border-white/20 hover:border-white/40 rounded-xl text-sm font-medium transition-colors text-white bg-transparent">
                        <Activity size={16} />
                        View Live Logs
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors">
                        Generate Report
                    </button>
                </div>
            </div>

            {/* Stat Cards - Minimalist Glassmorphism */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                {statCards.map((stat, idx) => (
                    <div
                        key={idx}
                        className="bg-[#111111]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 transition-all duration-300 hover:border-white/20"
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className="text-gray-400">
                                <stat.icon size={24} strokeWidth={1.5} />
                            </div>
                            <div className={`flex items-center gap-1 text-xs font-semibold ${stat.trend === 'up' ? 'text-emerald-400' : 'text-gray-400'
                                }`}>
                                {stat.trend === 'up' && <ArrowUpRight size={14} />}
                                {stat.change}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-3xl font-bold text-white mb-1 tracking-tight">
                                {stat.value.toLocaleString()}
                            </h3>
                            <p className="text-sm font-medium text-gray-400 flex items-center gap-1.5">
                                {stat.label}
                                <span className="text-xs font-normal opacity-50">• {stat.subtext}</span>
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Growth Chart */}
                <div className="lg:col-span-2 bg-[#111111]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden flex flex-col">

                    <div className="flex items-center justify-between mb-8 z-10">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                User Acquisition (30 Days)
                            </h2>
                            <p className="text-sm text-gray-400 mt-1">
                                <span className="text-emerald-400 font-semibold">+{stats?.statistics?.users?.new_30d || 0}</span> new users this month
                            </p>
                        </div>
                        <select className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50">
                            <option>Last 30 Days</option>
                            <option>Last 7 Days</option>
                        </select>
                    </div>

                    <div className="flex-1 min-h-[300px] w-full z-10 -ml-4">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ffffff" stopOpacity={0.05} />
                                            <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        stroke="rgba(255,255,255,0.2)"
                                        tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                                        tickMargin={10}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        stroke="rgba(255,255,255,0.2)"
                                        tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                                    <Area
                                        type="monotone"
                                        dataKey="Users"
                                        stroke="#ffffff"
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#colorUsers)"
                                        activeDot={{ r: 4, fill: '#fff', stroke: '#fff', strokeWidth: 2 }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full w-full flex flex-col items-center justify-center text-gray-500">
                                <Activity size={48} className="mb-4 opacity-20" />
                                <p>No growth data available for this period.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Popular Anime / Top Engagement */}
                <div className="bg-[#111111]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Heart className="text-pink-500" size={20} />
                            Most Favorited
                        </h2>
                        <Link to="/admin/anime" className="text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1">
                            View All <ExternalLink size={12} />
                        </Link>
                    </div>

                    <div className="flex-1 flex flex-col gap-3">
                        {stats?.popular_anime?.slice(0, 5).map((anime, idx) => (
                            <div key={anime.id} className="group relative bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl p-3 flex items-center gap-4 transition-all hover:pr-8">
                                <div className="w-10 h-10 rounded-lg border border-white/10 text-gray-400 flex items-center justify-center font-bold flex-shrink-0">
                                    #{idx + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-white truncate" title={anime.title}>
                                        {anime.title}
                                    </h4>
                                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                        <Heart size={10} className="text-gray-400" />
                                        {anime.favorite_count.toLocaleString()} saves
                                    </p>
                                </div>
                                <div className="absolute right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ChevronRight size={16} className="text-gray-400" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Tables Area - Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Recent Signups */}
                <div className="bg-[#111111]/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <UsersRound className="text-gray-400" size={20} />
                            Recent Signups
                        </h2>
                        <Link to="/admin/users" className="text-xs font-semibold text-gray-400 hover:text-white transition-colors">
                            Manage Users
                        </Link>
                    </div>
                    <div className="p-2">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">User</th>
                                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Status</th>
                                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Joined</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats?.recent_users?.slice(0, 5).map((user) => (
                                    <tr key={user.id} className="group hover:bg-white/5 transition-colors rounded-xl flex sm:table-row flex-col sm:flex-row mb-2 sm:mb-0">
                                        <td className="px-4 py-3 sm:rounded-l-xl">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-sm font-bold text-gray-400 flex-shrink-0">
                                                    {user.username.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-white truncate">{user.username}</p>
                                                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase ${user.is_active
                                                ? 'border border-emerald-500/20 text-emerald-400'
                                                : 'border border-red-500/20 text-red-400'
                                                }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                                                {user.is_active ? 'Active' : 'Suspended'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 sm:rounded-r-xl text-right">
                                            <p className="text-xs font-medium text-gray-400 flex items-center justify-end gap-1.5">
                                                <Clock size={12} />
                                                {new Date(user.date_joined).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                            </p>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Recent Reviews */}
                <div className="bg-[#111111]/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Star className="text-gray-400" size={20} />
                            Latest Reviews
                        </h2>
                        <Link to="/admin/reviews" className="text-xs font-semibold text-gray-400 hover:text-white transition-colors">
                            Moderate Reviews
                        </Link>
                    </div>
                    <div className="p-2">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Author & Review</th>
                                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Rating</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats?.recent_reviews?.slice(0, 5).map((review) => (
                                    <tr key={review.id} className="group hover:bg-white/5 transition-colors rounded-xl flex sm:table-row flex-col sm:flex-row mb-2 sm:mb-0">
                                        <td className="px-4 py-3 sm:rounded-l-xl">
                                            <div className="flex flex-col">
                                                <p className="text-sm font-semibold text-white whitespace-nowrap">{review.user}</p>
                                                <p className="text-xs font-medium text-gray-500 truncate max-w-[200px] sm:max-w-xs" title={review.anime}>
                                                    on <span className="text-purple-300">{review.anime}</span>
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 sm:rounded-r-xl text-right">
                                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${review.rating >= 8
                                                ? 'text-emerald-400 border border-emerald-500/20'
                                                : review.rating >= 5
                                                    ? 'text-amber-400 border border-amber-500/20'
                                                    : 'text-red-400 border border-red-500/20'
                                                }`}>
                                                <Star fill="currentColor" size={12} />
                                                {review.rating}/10
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {(!stats?.recent_reviews || stats.recent_reviews.length === 0) && (
                                    <tr>
                                        <td colSpan="2" className="py-8 text-center text-gray-500 text-sm">
                                            No recent reviews
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default AdminDashboard;
