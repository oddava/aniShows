import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';
import {
  Users, UserPlus, Zap, RefreshCw,
  Film, Tv, Building2, Tags,
  Heart, Star, ListPlus, Target,
  TrendingUp, Activity, PieChart, BarChart3,
  Bell, ChevronRight, Download, RefreshCcw,
  AlertTriangle, Database, Layers,
  BookOpen, ThumbsUp, ThumbsDown, Award,
  ArrowUpRight, ArrowDownRight,
  Shield, CheckCircle
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart as RechartsPieChart, Pie, Legend, LineChart, Line
} from 'recharts';

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'content', label: 'Content', icon: Film },
  { key: 'engagement', label: 'Engagement', icon: Heart },
];

const CHART_COLORS = [
  '#75698d', '#4f88a8', '#4f8d74', '#b88a52', '#b5626f',
  '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
  '#a855f7', '#22d3ee', '#34d399', '#fbbf24', '#fb7185',
];

const STATUS_COLORS = {
  'Airing': '#10b981',
  'Finished': '#6366f1',
  'Upcoming': '#f59e0b',
  'Not Yet Aired': '#f97316',
  'Cancelled': '#ef4444',
};

const LIST_STATUS_COLORS = {
  'Watching': '#75698d',
  'Completed': '#10b981',
  'On Hold': '#f59e0b',
  'Dropped': '#ef4444',
  'Plan to Watch': '#06b6d4',
};

// ─── Shared Components ───────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-dark/90 backdrop-blur-xl border border-white/10 p-3 rounded-xl shadow-2xl">
        <p className="text-gray-400 text-xs font-medium mb-2">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm font-bold flex items-center gap-2 mb-0.5" style={{ color: '#fff' }}>
            {entry.name}: {entry.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const StatCard = ({ title, value, change, changeType, icon: Icon, link, linkText, colorClass, bgClass }) => (
  <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 transition-all duration-300 hover:border-white/20">
    <div className="flex justify-between items-start mb-4">
      <div className="text-gray-400">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      {change !== undefined && change !== null && (
        <div className={`flex items-center gap-1 text-xs font-semibold ${changeType === 'positive' ? 'text-emerald-400' :
          changeType === 'negative' ? 'text-red-400' :
            'text-gray-400'
          }`}>
          {changeType === 'positive' ? <ArrowUpRight size={14} /> : changeType === 'negative' ? <ArrowDownRight size={14} /> : <Activity size={14} />}
          {Math.abs(change)}%
        </div>
      )}
    </div>
    <div>
      <h3 className="text-3xl font-bold text-white mb-1 tracking-tight">{value}</h3>
      <p className="text-sm font-medium text-gray-400">{title}</p>
    </div>
    {link && (
      <div className="mt-6 pt-4 border-t border-white/5 flex justify-between items-center">
        <Link to={link} className="text-sm font-medium text-gray-400 hover:text-white transition-colors flex items-center gap-1 group/link">
          {linkText}
        </Link>
        <ChevronRight size={14} className="text-gray-600 group-hover:text-white transition-colors" />
      </div>
    )}
  </div>
);

const ChartCard = ({ title, subtitle, icon: Icon, iconColor, iconBg, children, className = "" }) => (
  <div className={`bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden flex flex-col ${className}`}>
    <div className="flex items-center justify-between mb-8 z-10">
      <div>
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          {Icon && <Icon className="text-gray-400" size={20} />}
          {title}
        </h3>
        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);

const TableRanking = ({ title, icon: Icon, iconColor, data, columns, emptyText = "No data available" }) => (
  <ChartCard title={title} icon={Icon}>
    {data && data.length > 0 ? (
      <div className="space-y-3">
        {data.map((item, idx) => (
          <div key={idx} className="group relative bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl p-3 flex items-center gap-4 transition-all">
            <div className="w-8 h-8 rounded-lg border border-white/10 text-gray-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
              #{idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white truncate">{columns.title(item)}</h4>
              <p className="text-xs text-gray-400 mt-0.5">{columns.subtitle(item)}</p>
            </div>
            {columns.badge && (
              <div className="text-xs font-semibold text-gray-400 flex-shrink-0">
                {columns.badge(item)}
              </div>
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Database size={32} className="mb-2 opacity-30" />
        <p className="text-sm">{emptyText}</p>
      </div>
    )}
  </ChartCard>
);

const LoadingSpinner = ({ text = "Loading..." }) => (
  <div className="flex items-center justify-center min-h-[300px]">
    <div className="flex flex-col items-center">
      <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
      <p className="text-gray-400 font-medium text-sm animate-pulse">{text}</p>
    </div>
  </div>
);

const EmptyState = ({ onRetry }) => (
  <div className="flex flex-col items-center justify-center min-h-[300px] bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl border-dashed">
    <Activity size={48} className="text-gray-600 mb-4" />
    <h3 className="text-lg font-bold text-white mb-2">No Data Available</h3>
    <p className="text-gray-400 mb-6 text-sm text-center max-w-md">Could not load analytics data for this period.</p>
    <button onClick={onRetry} className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors font-medium text-sm flex items-center gap-2">
      <RefreshCcw size={16} /> Try Again
    </button>
  </div>
);

// ─── Pie label renderer ──────────────────────────────────────────────────────

const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// ─── Tab: Overview ───────────────────────────────────────────────────────────

const OverviewTab = ({ stats }) => {
  const userGrowthData = useMemo(() => {
    if (!stats?.users?.growth_by_day) return [];
    return stats.users.growth_by_day.map(item => ({
      name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      users: item.count,
    }));
  }, [stats]);

  const dailySignupsData = useMemo(() => {
    if (!stats?.users?.daily_signups) return [];
    return stats.users.daily_signups.map(item => ({
      name: new Date(item.date).toLocaleDateString('en-US', { weekday: 'short' }),
      signups: item.count,
    }));
  }, [stats]);

  const getChangeType = (val) => {
    if (val === undefined || val === null) return 'neutral';
    return val >= 0 ? 'positive' : 'negative';
  };

  return (
    <div className="space-y-8">
      {/* User Stats */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Users size={20} className="text-purple-400" /> User Growth
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          <StatCard title="Total Users" value={stats.users?.total?.toLocaleString() || '0'} change={stats.users?.growth} changeType={getChangeType(stats.users?.growth)} icon={Users} colorClass="text-blue-400" bgClass="bg-blue-500/10" link="/admin/users" linkText="Manage users" />
          <StatCard title="New Users" value={stats.users?.new?.toLocaleString() || '0'} change={stats.users?.new_growth} changeType={getChangeType(stats.users?.new_growth)} icon={UserPlus} colorClass="text-emerald-400" bgClass="bg-emerald-500/10" />
          <StatCard title="Active Users" value={stats.users?.active?.toLocaleString() || '0'} change={stats.users?.active_growth} changeType={getChangeType(stats.users?.active_growth)} icon={Zap} colorClass="text-amber-400" bgClass="bg-amber-500/10" />
          <StatCard title="User Retention" value={`${stats.users?.retention || 0}%`} change={stats.users?.retention_change} changeType={getChangeType(stats.users?.retention_change)} icon={RefreshCw} colorClass="text-pink-400" bgClass="bg-pink-500/10" />
        </div>
      </section>

      {/* Content Stats */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Film size={20} className="text-indigo-400" /> Content Library
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          <StatCard title="Total Anime" value={stats.content?.anime_total?.toLocaleString() || '0'} icon={Tv} colorClass="text-indigo-400" bgClass="bg-indigo-500/10" link="/admin/anime" linkText="Manage library" />
          <StatCard title="Total Episodes" value={stats.content?.episodes_total?.toLocaleString() || '0'} icon={Film} colorClass="text-cyan-400" bgClass="bg-cyan-500/10" />
          <StatCard title="Studios" value={stats.content?.studios_total?.toLocaleString() || '0'} icon={Building2} colorClass="text-purple-400" bgClass="bg-purple-500/10" link="/admin/studios" linkText="View studios" />
          <StatCard title="Genres" value={stats.content?.genres_total?.toLocaleString() || '0'} icon={Tags} colorClass="text-orange-400" bgClass="bg-orange-500/10" link="/admin/genres" linkText="Manage genres" />
        </div>
      </section>

      {/* Engagement Stats */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Heart size={20} className="text-pink-400" /> Platform Engagement
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          <StatCard title="Total Favorites" value={stats.engagement?.favorites?.toLocaleString() || '0'} change={stats.engagement?.favorites_growth} changeType={getChangeType(stats.engagement?.favorites_growth)} icon={Heart} colorClass="text-pink-500" bgClass="bg-pink-500/10" />
          <StatCard title="Total Reviews" value={stats.engagement?.reviews?.toLocaleString() || '0'} change={stats.engagement?.reviews_growth} changeType={getChangeType(stats.engagement?.reviews_growth)} icon={Star} colorClass="text-amber-400" bgClass="bg-amber-500/10" link="/admin/reviews" linkText="Moderate reviews" />
          <StatCard title="User Lists" value={stats.engagement?.watchlists?.toLocaleString() || '0'} change={stats.engagement?.watchlists_growth} changeType={getChangeType(stats.engagement?.watchlists_growth)} icon={ListPlus} colorClass="text-emerald-400" bgClass="bg-emerald-500/10" />
          <StatCard title="Average Rating" value={stats.engagement?.avg_rating ? Number(stats.engagement.avg_rating).toFixed(1) : '0.0'} icon={Target} colorClass="text-blue-400" bgClass="bg-blue-500/10" />
        </div>
      </section>

      {/* Charts */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <TrendingUp size={20} className="text-emerald-400" /> Trends
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="User Growth" subtitle="New registrations over time" icon={TrendingUp} iconColor="text-purple-400" iconBg="bg-purple-500/10">
            <div className="h-64 w-full">
              {userGrowthData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={userGrowthData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ffffff" stopOpacity={0.05} />
                        <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickMargin={10} axisLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="users" name="New Users" stroke="#ffffff" strokeWidth={2} fillOpacity={1} fill="url(#colorGrowth)" activeDot={{ r: 4, fill: '#fff', stroke: '#fff', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">No growth data for this period</div>
              )}
            </div>
          </ChartCard>

          <ChartCard title="Recent Signups" subtitle="Last 7 days" icon={BarChart3} iconColor="text-emerald-400" iconBg="bg-emerald-500/10">
            <div className="h-64 w-full">
              {dailySignupsData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailySignupsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickMargin={10} axisLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-overlay-soft)' }} />
                    <Bar dataKey="signups" name="Signups" radius={[4, 4, 0, 0]}>
                      {dailySignupsData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill="#ffffff" fillOpacity={0.2} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">No signup data for this period</div>
              )}
            </div>
          </ChartCard>
        </div>
      </section>

      {/* Activity Log & Export */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Bell size={20} className="text-amber-400" /> Activity Log
            </h3>
          </div>
          <div className="space-y-3">
            {stats.recent_activity && stats.recent_activity.length > 0 ? (
              stats.recent_activity.slice(0, 8).map((activity, index) => (
                <div key={index} className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0">
                  <div className="text-gray-500 flex-shrink-0">
                    {activity.type === 'CREATE' ? <UserPlus size={18} strokeWidth={1.5} /> :
                      activity.type === 'DELETE' ? <AlertTriangle size={18} strokeWidth={1.5} /> :
                        activity.type === 'UPDATE' ? <RefreshCw size={18} strokeWidth={1.5} /> :
                          <Activity size={18} strokeWidth={1.5} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-300 truncate">{activity.text}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(activity.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Bell size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No recent activity</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
          <Download size={48} className="text-purple-400 mb-4 opacity-50" />
          <h3 className="text-xl font-bold text-white mb-2">Export Data</h3>
          <p className="text-sm text-gray-400 mb-6">Download a full JSON export of all platform statistics.</p>
          <div className="text-xs text-gray-500">Use the export button in the toolbar above</div>
        </div>
      </div>
    </div>
  );
};

// ─── Tab: Users ──────────────────────────────────────────────────────────────

const UsersTab = ({ data, loading }) => {
  if (loading) return <LoadingSpinner text="Loading user analytics..." />;
  if (!data) return <EmptyState onRetry={() => { }} />;

  const registrationData = useMemo(() => {
    if (!data.registration_trend || !Array.isArray(data.registration_trend)) return [];
    return data.registration_trend.map(item => ({
      name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      registrations: item.count,
    }));
  }, [data]);

  const userBreakdownData = useMemo(() => {
    if (!data.user_breakdown) return [];
    return [
      { name: 'Active', value: data.user_breakdown.active || 0, color: '#10b981' },
      { name: 'Inactive', value: data.user_breakdown.inactive || 0, color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [data]);

  const verificationData = useMemo(() => {
    if (!data.user_breakdown) return [];
    return [
      { name: 'Verified', value: data.user_breakdown.verified || 0, color: '#75698d' },
      { name: 'Unverified', value: data.user_breakdown.unverified || 0, color: '#6b7280' },
    ].filter(d => d.value > 0);
  }, [data]);

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard title="Total Users" value={data.total_users?.toLocaleString() || '0'} icon={Users} colorClass="text-blue-400" bgClass="bg-blue-500/10" />
        <StatCard title="New Users" value={data.new_users?.toLocaleString() || '0'} icon={UserPlus} colorClass="text-emerald-400" bgClass="bg-emerald-500/10" />
        <StatCard title="Returning Users" value={data.returning_users?.toLocaleString() || '0'} icon={RefreshCw} colorClass="text-amber-400" bgClass="bg-amber-500/10" />
        <StatCard title="Staff Members" value={data.user_breakdown?.staff?.toLocaleString() || '0'} icon={Shield} colorClass="text-purple-400" bgClass="bg-purple-500/10" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Registration Trend" subtitle="New user signups over time" icon={TrendingUp} iconColor="text-purple-400" iconBg="bg-purple-500/10">
          <div className="h-64 w-full">
            {registrationData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={registrationData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorReg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ffffff" stopOpacity={0.05} />
                      <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickMargin={10} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="registrations" name="Registrations" stroke="#ffffff" strokeWidth={2} fillOpacity={1} fill="url(#colorReg)" activeDot={{ r: 4, fill: '#fff', stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No registration data</div>
            )}
          </div>
        </ChartCard>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <ChartCard title="Account Status" icon={CheckCircle} iconColor="text-emerald-400" iconBg="bg-emerald-500/10">
            <div className="h-48 w-full">
              {userBreakdownData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPieChart>
                    <Pie data={userBreakdownData} cx="50%" cy="50%" outerRadius={70} innerRadius={35} dataKey="value" labelLine={false} label={renderPieLabel}>
                      {userBreakdownData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                    <RechartsTooltip content={<CustomTooltip />} />
                  </RechartsPieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">No data</div>
              )}
            </div>
          </ChartCard>

          <ChartCard title="Email Verification" icon={CheckCircle} iconColor="text-purple-400" iconBg="bg-purple-500/10">
            <div className="h-48 w-full">
              {verificationData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPieChart>
                    <Pie data={verificationData} cx="50%" cy="50%" outerRadius={70} innerRadius={35} dataKey="value" labelLine={false} label={renderPieLabel}>
                      {verificationData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                    <RechartsTooltip content={<CustomTooltip />} />
                  </RechartsPieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">No data</div>
              )}
            </div>
          </ChartCard>
        </div>
      </div>

      {/* Most Active Users */}
      <TableRanking
        title="Most Active Users"
        icon={Award}
        iconColor="text-amber-400"
        data={data.active_users?.slice(0, 10)}
        columns={{
          title: (u) => u.username,
          subtitle: (u) => `${u.list_entries} lists  |  ${u.reviews} reviews  |  ${u.favorites} favorites`,
          badge: (u) => `${(u.list_entries + u.reviews + u.favorites).toLocaleString()} actions`,
        }}
        emptyText="No active users found"
      />
    </div>
  );
};

// ─── Tab: Content ────────────────────────────────────────────────────────────

const ContentTab = ({ data, loading }) => {
  if (loading) return <LoadingSpinner text="Loading content analytics..." />;
  if (!data) return <EmptyState onRetry={() => { }} />;

  const statusData = useMemo(() => {
    const raw = data.by_status;
    if (!raw) return [];
    // Handle both array [{status, count}] and object {status: count} formats
    if (Array.isArray(raw)) {
      return raw.map(item => ({
        name: item.status || 'Unknown',
        value: item.count,
        color: STATUS_COLORS[item.status] || '#6b7280',
      }));
    }
    return Object.entries(raw).map(([status, count]) => ({
      name: status || 'Unknown',
      value: count,
      color: STATUS_COLORS[status] || '#6b7280',
    }));
  }, [data]);

  const typeData = useMemo(() => {
    const raw = data.by_type;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((item, i) => ({
        name: item.anime_type || 'Unknown',
        value: item.count,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
    }
    return Object.entries(raw).map(([type, count], i) => ({
      name: type || 'Unknown',
      value: count,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [data]);

  const genreData = useMemo(() => {
    if (!data.top_genres || !Array.isArray(data.top_genres)) return [];
    return data.top_genres.map(item => ({
      name: item.name,
      anime: item.anime_count,
    }));
  }, [data]);

  const studioData = useMemo(() => {
    if (!data.top_studios || !Array.isArray(data.top_studios)) return [];
    return data.top_studios.map(item => ({
      name: item.name,
      anime: item.anime_count,
    }));
  }, [data]);

  const contentTrendData = useMemo(() => {
    if (!data.content_trend || !Array.isArray(data.content_trend)) return [];
    return data.content_trend.map(item => ({
      name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      added: item.count,
    }));
  }, [data]);

  const metadataHealth = data.missing_metadata;

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard title="Total Anime" value={data.total_anime?.toLocaleString() || '0'} icon={Tv} colorClass="text-indigo-400" bgClass="bg-indigo-500/10" />
        <StatCard title="New This Period" value={data.new_anime?.toLocaleString() || '0'} icon={Film} colorClass="text-cyan-400" bgClass="bg-cyan-500/10" />
        <StatCard title="Metadata Health" value={`${metadataHealth?.completeness || 0}%`} icon={Database} colorClass="text-emerald-400" bgClass="bg-emerald-500/10" />
        <StatCard title="Missing Data" value={((metadataHealth?.cover_image || 0) + (metadataHealth?.synopsis || 0) + (metadataHealth?.studio || 0)).toLocaleString()} icon={AlertTriangle} colorClass="text-amber-400" bgClass="bg-amber-500/10" />
      </div>

      {/* Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Anime by Status" subtitle="Content status breakdown" icon={Layers} iconColor="text-indigo-400" iconBg="bg-indigo-500/10">
          <div className="h-72 w-full">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie data={statusData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value" labelLine={false} label={renderPieLabel}>
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                  <RechartsTooltip content={<CustomTooltip />} />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No data</div>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Anime by Type" subtitle="TV, Movie, OVA, Special" icon={Film} iconColor="text-cyan-400" iconBg="bg-cyan-500/10">
          <div className="h-72 w-full">
            {typeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie data={typeData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value" labelLine={false} label={renderPieLabel}>
                    {typeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                  <RechartsTooltip content={<CustomTooltip />} />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No data</div>
            )}
          </div>
        </ChartCard>
      </div>

      {/* Genre & Studio Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Top Genres" subtitle="By number of anime" icon={Tags} iconColor="text-orange-400" iconBg="bg-orange-500/10">
          <div className="h-80 w-full">
            {genreData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={genreData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" horizontal={false} />
                  <XAxis type="number" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-overlay-soft)' }} />
                  <Bar dataKey="anime" name="Anime Count" radius={[0, 4, 4, 0]}>
                    {genreData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill="#ffffff" fillOpacity={0.2} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No genre data</div>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Top Studios" subtitle="By number of anime" icon={Building2} iconColor="text-purple-400" iconBg="bg-purple-500/10">
          <div className="h-80 w-full">
            {studioData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={studioData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" horizontal={false} />
                  <XAxis type="number" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 11 }} tickLine={false} axisLine={false} width={120} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-overlay-soft)' }} />
                  <Bar dataKey="anime" name="Anime Count" radius={[0, 4, 4, 0]} fill="#ffffff" fillOpacity={0.2} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No studio data</div>
            )}
          </div>
        </ChartCard>
      </div>

      {/* Content Added Over Time */}
      {contentTrendData.length > 0 && (
        <ChartCard title="Content Added Over Time" subtitle="New anime entries" icon={TrendingUp} iconColor="text-emerald-400" iconBg="bg-emerald-500/10">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={contentTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorContent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffffff" stopOpacity={0.05} />
                    <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickMargin={10} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="added" name="Anime Added" stroke="#ffffff" strokeWidth={2} fillOpacity={1} fill="url(#colorContent)" activeDot={{ r: 4, fill: '#fff', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Metadata Health */}
      {metadataHealth && (
        <ChartCard title="Metadata Completeness" subtitle="Data quality overview" icon={Database} iconColor="text-amber-400" iconBg="bg-amber-500/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
            {[
              { label: 'Missing Cover', value: metadataHealth.cover_image, total: metadataHealth.total },
              { label: 'Missing Synopsis', value: metadataHealth.synopsis, total: metadataHealth.total },
              { label: 'Missing Studio', value: metadataHealth.studio, total: metadataHealth.total },
              { label: 'Missing Rating', value: metadataHealth.rating, total: metadataHealth.total },
            ].map((item, idx) => {
              const pct = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
              return (
                <div key={idx} className="bg-white/5 border border-white/5 rounded-xl p-4 transition-all hover:bg-white/10">
                  <p className="text-xs text-gray-400 font-medium mb-1">{item.label}</p>
                  <p className={`text-2xl font-bold text-white`}>{item.value?.toLocaleString() || 0}</p>
                  <div className="mt-2 w-full bg-white/10 rounded-full h-1">
                    <div className="h-1 rounded-full bg-white/40" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">{pct}% of {item.total?.toLocaleString() || 0} anime</p>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}
    </div>
  );
};

// ─── Tab: Engagement ─────────────────────────────────────────────────────────

const EngagementTab = ({ data, loading }) => {
  if (loading) return <LoadingSpinner text="Loading engagement analytics..." />;
  if (!data) return <EmptyState onRetry={() => { }} />;

  const ratingData = useMemo(() => {
    const raw = data.reviews_by_rating;
    if (!raw) return [];
    // Handle both array [{rating, count}] and object {rating: count} formats
    if (Array.isArray(raw)) {
      return raw.map(item => ({
        name: `${item.rating}/10`,
        reviews: item.count,
        rating: item.rating,
      }));
    }
    return Object.entries(raw).map(([rating, count]) => ({
      name: `${rating}/10`,
      reviews: count,
      rating: Number(rating),
    }));
  }, [data]);

  const listStatusData = useMemo(() => {
    const raw = data.list_by_status;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(item => ({
        name: item.status || 'Unknown',
        value: item.count,
        color: LIST_STATUS_COLORS[item.status] || '#6b7280',
      }));
    }
    return Object.entries(raw).map(([status, count]) => ({
      name: status || 'Unknown',
      value: count,
      color: LIST_STATUS_COLORS[status] || '#6b7280',
    }));
  }, [data]);

  const reviewsTrendData = useMemo(() => {
    if (!data.reviews_trend || !Array.isArray(data.reviews_trend)) return [];
    const dateMap = {};
    data.reviews_trend.forEach(item => {
      const dateKey = item.date;
      if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, reviews: 0, favorites: 0 };
      dateMap[dateKey].reviews = item.count;
    });
    if (data.favorites_trend && Array.isArray(data.favorites_trend)) {
      data.favorites_trend.forEach(item => {
        const dateKey = item.date;
        if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, reviews: 0, favorites: 0 };
        dateMap[dateKey].favorites = item.count;
      });
    }
    return Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(item => ({
        name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        reviews: item.reviews,
        favorites: item.favorites,
      }));
  }, [data]);

  const getRatingColor = (rating) => {
    if (rating >= 8) return '#10b981';
    if (rating >= 6) return '#75698d';
    if (rating >= 4) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard title="Total Reviews" value={data.total_reviews?.toLocaleString() || '0'} icon={Star} colorClass="text-amber-400" bgClass="bg-amber-500/10" />
        <StatCard title="New Reviews" value={data.new_reviews?.toLocaleString() || '0'} icon={BookOpen} colorClass="text-blue-400" bgClass="bg-blue-500/10" />
        <StatCard title="Average Rating" value={data.avg_rating ? Number(data.avg_rating).toFixed(1) : '0.0'} icon={Target} colorClass="text-emerald-400" bgClass="bg-emerald-500/10" />
        <StatCard
          title="Review Sentiment"
          value={
            data.review_votes
              ? `${data.review_votes.helpful + data.review_votes.unhelpful > 0
                ? Math.round((data.review_votes.helpful / (data.review_votes.helpful + data.review_votes.unhelpful)) * 100)
                : 0}% positive`
              : 'N/A'
          }
          icon={ThumbsUp}
          colorClass="text-pink-400"
          bgClass="bg-pink-500/10"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Rating Distribution" subtitle="Reviews by score" icon={BarChart3} iconColor="text-amber-400" iconBg="bg-amber-500/10">
          <div className="h-72 w-full">
            {ratingData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickMargin={10} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-overlay-soft)' }} />
                  <Bar dataKey="reviews" name="Reviews" radius={[4, 4, 0, 0]}>
                    {ratingData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill="#ffffff" fillOpacity={0.2} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No rating data</div>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Watchlist Distribution" subtitle="User list entries by status" icon={ListPlus} iconColor="text-indigo-400" iconBg="bg-indigo-500/10">
          <div className="h-72 w-full">
            {listStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie data={listStatusData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value" labelLine={false} label={renderPieLabel}>
                    {listStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                  <RechartsTooltip content={<CustomTooltip />} />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No list data</div>
            )}
          </div>
        </ChartCard>
      </div>

      {/* Engagement Trend */}
      {reviewsTrendData.length > 0 && (
        <ChartCard title="Engagement Trend" subtitle="Reviews and favorites over time" icon={Activity} iconColor="text-emerald-400" iconBg="bg-emerald-500/10">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={reviewsTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-soft)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickMargin={10} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#9ca3af', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="reviews" name="Reviews" stroke="#ffffff" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: '#fff', stroke: '#fff', strokeWidth: 2 }} />
                <Line type="monotone" dataKey="favorites" name="Favorites" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: 'rgba(255,255,255,0.4)', stroke: 'rgba(255,255,255,0.4)', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Review Votes */}
      {data.review_votes && (data.review_votes.helpful > 0 || data.review_votes.unhelpful > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 transition-all duration-300 hover:border-white/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-gray-400">
                <ThumbsUp size={24} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-gray-400 text-sm font-medium">Helpful Votes</h3>
                <p className="text-3xl font-bold text-white tracking-tight mt-1">{data.review_votes.helpful.toLocaleString()}</p>
              </div>
            </div>
            <div className="w-full bg-white/5 rounded-full h-1.5 mt-4">
              <div className="h-1.5 rounded-full bg-white/40" style={{ width: `${data.review_votes.helpful + data.review_votes.unhelpful > 0 ? (data.review_votes.helpful / (data.review_votes.helpful + data.review_votes.unhelpful)) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 transition-all duration-300 hover:border-white/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-gray-400">
                <ThumbsDown size={24} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-gray-400 text-sm font-medium">Unhelpful Votes</h3>
                <p className="text-3xl font-bold text-white tracking-tight mt-1">{data.review_votes.unhelpful.toLocaleString()}</p>
              </div>
            </div>
            <div className="w-full bg-white/5 rounded-full h-1.5 mt-4">
              <div className="h-1.5 rounded-full bg-white/20" style={{ width: `${data.review_votes.helpful + data.review_votes.unhelpful > 0 ? (data.review_votes.unhelpful / (data.review_votes.helpful + data.review_votes.unhelpful)) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Top Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TableRanking
          title="Most Reviewed Anime"
          icon={Star}
          iconColor="text-amber-400"
          data={data.most_reviewed}
          columns={{
            title: (a) => a.title,
            subtitle: (a) => `Rating: ${a.rating ? Number(a.rating).toFixed(1) : 'N/A'}/10`,
            badge: (a) => `${a.review_count} reviews`,
          }}
          emptyText="No reviews yet"
        />
        <TableRanking
          title="Most Favorited Anime"
          icon={Heart}
          iconColor="text-pink-400"
          data={data.most_favorited}
          columns={{
            title: (a) => a.title,
            subtitle: (a) => `Rating: ${a.rating ? Number(a.rating).toFixed(1) : 'N/A'}/10`,
            badge: (a) => `${a.favorite_count} favorites`,
          }}
          emptyText="No favorites yet"
        />
      </div>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const AdminReports = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [dateRange, setDateRange] = useState('30');
  const [overviewData, setOverviewData] = useState(null);
  const [usersData, setUsersData] = useState(null);
  const [contentData, setContentData] = useState(null);
  const [engagementData, setEngagementData] = useState(null);
  const [loading, setLoading] = useState({
    overview: true,
    users: false,
    content: false,
    engagement: false,
  });
  const [exporting, setExporting] = useState(false);

  const fetchTabData = useCallback(async (tab, days, forceRefresh = false) => {
    setLoading(prev => ({ ...prev, [tab]: true }));
    try {
      const params = new URLSearchParams({ type: tab, days });
      if (forceRefresh) {
        params.set('refresh', 'true');
      }
      const response = await api.get(`/admin/reports/?${params}`);
      switch (tab) {
        case 'overview': setOverviewData(response.data); break;
        case 'users': setUsersData(response.data); break;
        case 'content': setContentData(response.data); break;
        case 'engagement': setEngagementData(response.data); break;
      }
    } catch (err) {
      logger.error(`Failed to fetch ${tab} report:`, err);
      toast.error(`Failed to load ${tab} report`);
    } finally {
      setLoading(prev => ({ ...prev, [tab]: false }));
    }
  }, []);

  // Fetch overview on mount
  useEffect(() => {
    fetchTabData('overview', dateRange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when tab or date range changes
  useEffect(() => {
    fetchTabData(activeTab, dateRange);
  }, [activeTab, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    switch (activeTab) {
      case 'overview': setOverviewData(null); break;
      case 'users': setUsersData(null); break;
      case 'content': setContentData(null); break;
      case 'engagement': setEngagementData(null); break;
    }
    fetchTabData(activeTab, dateRange, true);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.get('/admin/stats/export/');
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anishows-analytics-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Analytics data exported successfully');
    } catch (err) {
      logger.error('Failed to export stats:', err);
      toast.error('Failed to export analytics data');
    } finally {
      setExporting(false);
    }
  };

  const isCurrentTabLoading = loading[activeTab];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Analytics & Reports</h1>
          <p className="text-gray-400 mt-1">Platform performance, growth, and engagement metrics.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-white/20 appearance-none cursor-pointer pr-10 hover:bg-white/10 transition-colors"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(255,255,255,0.5)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
              backgroundPosition: 'right 0.75rem center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: '1.25em 1.25em',
            }}
          >
            <option value="7" className="bg-dark-100">Last 7 days</option>
            <option value="30" className="bg-dark-100">Last 30 days</option>
            <option value="90" className="bg-dark-100">Last 90 days</option>
            <option value="365" className="bg-dark-100">Last year</option>
          </select>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-sm font-semibold transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} className={exporting ? 'animate-bounce' : ''} />
            {exporting ? 'Exporting...' : 'Export'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isCurrentTabLoading}
            className="px-4 py-2.5 bg-white text-black hover:bg-gray-200 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCcw size={16} className={isCurrentTabLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-dark/60 backdrop-blur-xl border border-white/5 rounded-2xl p-1.5 overflow-x-auto">
        {TABS.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap ${activeTab === key
              ? 'bg-white/10 text-white shadow-sm border border-white/10'
              : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
          >
            <TabIcon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          loading.overview && !overviewData ? (
            <LoadingSpinner text="Analyzing platform data..." />
          ) : overviewData ? (
            <OverviewTab stats={overviewData} />
          ) : (
            <EmptyState onRetry={handleRefresh} />
          )
        )}
        {activeTab === 'users' && (
          <UsersTab data={usersData} loading={loading.users} />
        )}
        {activeTab === 'content' && (
          <ContentTab data={contentData} loading={loading.content} />
        )}
        {activeTab === 'engagement' && (
          <EngagementTab data={engagementData} loading={loading.engagement} />
        )}
      </div>
    </div>
  );
};

export default AdminReports;
