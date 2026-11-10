import { useMemo } from 'react';
import {
  Users, UserPlus, RefreshCw, TrendingUp, Award, Shield, CheckCircle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  Cell, PieChart as RechartsPieChart, Pie, Legend,
} from 'recharts';
import {
  ChartCard, CustomTooltip, EmptyState, LoadingSpinner, StatCard, TableRanking, renderPieLabel,
} from './reportsShared';

// ─── Tab: Users ──────────────────────────────────────────────────────────────

const UsersTab = ({ data, loading }) => {
  const registrationData = useMemo(() => {
    if (!data?.registration_trend || !Array.isArray(data.registration_trend)) return [];
    return data.registration_trend.map(item => ({
      name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      registrations: item.count,
    }));
  }, [data]);

  const userBreakdownData = useMemo(() => {
    if (!data?.user_breakdown) return [];
    return [
      { name: 'Active', value: data.user_breakdown.active || 0, color: '#10b981' },
      { name: 'Inactive', value: data.user_breakdown.inactive || 0, color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [data]);

  const verificationData = useMemo(() => {
    if (!data?.user_breakdown) return [];
    return [
      { name: 'Verified', value: data.user_breakdown.verified || 0, color: '#75698d' },
      { name: 'Unverified', value: data.user_breakdown.unverified || 0, color: '#6b7280' },
    ].filter(d => d.value > 0);
  }, [data]);

  if (loading) return <LoadingSpinner text="Loading user analytics..." />;
  if (!data) return <EmptyState onRetry={() => { }} />;

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

export default UsersTab;
