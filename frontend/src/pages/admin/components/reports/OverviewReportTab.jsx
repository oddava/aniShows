import { useMemo } from 'react';
import {
  Users, UserPlus, Zap, RefreshCw,
  Film, Tv, Building2, Tags,
  Heart, Star, ListPlus, Target,
  TrendingUp, Activity, BarChart3,
  Bell, Download, AlertTriangle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { ChartCard, CustomTooltip, StatCard } from './reportsShared';

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

export default OverviewTab;
