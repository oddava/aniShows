import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { toast } from 'react-hot-toast';

const AdminReports = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        days: dateRange,
      });
      const response = await api.get(`/admin/reports/?${params}`);
      setStats(response.data);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const StatCard = ({ title, value, change, changeType, icon, link, linkText }) => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/[0.07] transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-white/60 text-sm font-medium mb-1">{title}</p>
          <h3 className="text-3xl font-bold text-white">{value}</h3>
          {change !== undefined && (
            <div className={`flex items-center gap-1 mt-2 text-sm ${
              changeType === 'positive' ? 'text-green-400' :
              changeType === 'negative' ? 'text-red-400' :
              'text-white/60'
            }`}>
              <span>{changeType === 'positive' ? '↑' : changeType === 'negative' ? '↓' : '→'}</span>
              <span>{Math.abs(change)}% from last period</span>
            </div>
          )}
        </div>
        <div className="w-12 h-12 bg-violet-500/20 rounded-xl flex items-center justify-center text-2xl">
          {icon}
        </div>
      </div>
      {link && (
        <Link
          to={link}
          className="inline-block mt-4 text-violet-400 text-sm hover:text-violet-300 transition-colors"
        >
          {linkText} →
        </Link>
      )}
    </div>
  );

  const ActivityItem = ({ icon, text, time, color = 'violet' }) => (
    <div className="flex items-center gap-4 p-4 bg-white/5 border border-white/10 rounded-lg">
      <div className={`w-10 h-10 bg-${color}-500/20 rounded-lg flex items-center justify-center text-lg`}>
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-white">{text}</p>
        <p className="text-white/50 text-sm">{time}</p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white">Reports Overview</h1>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          >
            <option value="7" className="bg-[#1a1a1a]">Last 7 days</option>
            <option value="30" className="bg-[#1a1a1a]">Last 30 days</option>
            <option value="90" className="bg-[#1a1a1a]">Last 90 days</option>
            <option value="365" className="bg-[#1a1a1a]">Last year</option>
          </select>
          <button
            onClick={fetchStats}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-white/60">
          <div className="w-12 h-12 border-3 border-violet-500/20 border-t-violet-500 rounded-full animate-spin mb-4"></div>
          <p>Loading reports...</p>
        </div>
      ) : stats ? (
        <div className="space-y-6">
          {/* User Stats */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span>👥</span> User Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Users"
                value={stats.users?.total?.toLocaleString() || '0'}
                change={stats.users?.growth}
                changeType={stats.users?.growth >= 0 ? 'positive' : 'negative'}
                icon="👤"
                link="/admin/users"
                linkText="View all users"
              />
              <StatCard
                title="New Users (Period)"
                value={stats.users?.new?.toLocaleString() || '0'}
                change={stats.users?.new_growth}
                changeType={stats.users?.new_growth >= 0 ? 'positive' : 'negative'}
                icon="🆕"
              />
              <StatCard
                title="Active Users"
                value={stats.users?.active?.toLocaleString() || '0'}
                change={stats.users?.active_growth}
                changeType={stats.users?.active_growth >= 0 ? 'positive' : 'negative'}
                icon="⚡"
              />
              <StatCard
                title="User Retention"
                value={`${stats.users?.retention || 0}%`}
                change={stats.users?.retention_change}
                changeType={stats.users?.retention_change >= 0 ? 'positive' : 'negative'}
                icon="🔄"
              />
            </div>
          </div>

          {/* Content Stats */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span>📚</span> Content Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Anime"
                value={stats.content?.anime_total?.toLocaleString() || '0'}
                icon="🎬"
                link="/admin/anime"
                linkText="Manage anime"
              />
              <StatCard
                title="Episodes"
                value={stats.content?.episodes_total?.toLocaleString() || '0'}
                icon="📺"
              />
              <StatCard
                title="Studios"
                value={stats.content?.studios_total?.toLocaleString() || '0'}
                icon="🏢"
                link="/admin/studios"
                linkText="Manage studios"
              />
              <StatCard
                title="Genres"
                value={stats.content?.genres_total?.toLocaleString() || '0'}
                icon="🏷️"
                link="/admin/genres"
                linkText="Manage genres"
              />
            </div>
          </div>

          {/* Engagement Stats */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span>💫</span> Engagement Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Favorites"
                value={stats.engagement?.favorites?.toLocaleString() || '0'}
                change={stats.engagement?.favorites_growth}
                changeType={stats.engagement?.favorites_growth >= 0 ? 'positive' : 'negative'}
                icon="❤️"
                link="/admin/favorites"
                linkText="View favorites"
              />
              <StatCard
                title="Reviews"
                value={stats.engagement?.reviews?.toLocaleString() || '0'}
                change={stats.engagement?.reviews_growth}
                changeType={stats.engagement?.reviews_growth >= 0 ? 'positive' : 'negative'}
                icon="⭐"
                link="/admin/reviews"
                linkText="View reviews"
              />
              <StatCard
                title="Watchlists"
                value={stats.engagement?.watchlists?.toLocaleString() || '0'}
                change={stats.engagement?.watchlists_growth}
                changeType={stats.engagement?.watchlists_growth >= 0 ? 'positive' : 'negative'}
                icon="📋"
                link="/admin/lists"
                linkText="View lists"
              />
              <StatCard
                title="Avg Rating"
                value={stats.engagement?.avg_rating?.toFixed(1) || '0.0'}
                icon="🎯"
              />
            </div>
          </div>

          {/* Charts Placeholder Section */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span>📊</span> Trends & Analytics
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User Growth Chart Placeholder */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="text-white font-medium mb-4">User Growth Over Time</h3>
                <div className="h-64 flex items-center justify-center bg-white/5 rounded-lg border border-white/5 border-dashed">
                  <div className="text-center">
                    <span className="text-4xl mb-2 block">📈</span>
                    <span className="text-white/40">User growth chart placeholder</span>
                    <p className="text-white/30 text-sm mt-2">Integrate with Chart.js or Recharts</p>
                  </div>
                </div>
              </div>

              {/* Content Activity Chart Placeholder */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="text-white font-medium mb-4">Content Activity</h3>
                <div className="h-64 flex items-center justify-center bg-white/5 rounded-lg border border-white/5 border-dashed">
                  <div className="text-center">
                    <span className="text-4xl mb-2 block">📉</span>
                    <span className="text-white/40">Activity chart placeholder</span>
                    <p className="text-white/30 text-sm mt-2">Integrate with Chart.js or Recharts</p>
                  </div>
                </div>
              </div>

              {/* Popular Content Chart Placeholder */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="text-white font-medium mb-4">Most Popular Content</h3>
                <div className="h-64 flex items-center justify-center bg-white/5 rounded-lg border border-white/5 border-dashed">
                  <div className="text-center">
                    <span className="text-4xl mb-2 block">🥧</span>
                    <span className="text-white/40">Popular content chart placeholder</span>
                    <p className="text-white/30 text-sm mt-2">Integrate with Chart.js or Recharts</p>
                  </div>
                </div>
              </div>

              {/* Engagement Distribution Chart Placeholder */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="text-white font-medium mb-4">Engagement Distribution</h3>
                <div className="h-64 flex items-center justify-center bg-white/5 rounded-lg border border-white/5 border-dashed">
                  <div className="text-center">
                    <span className="text-4xl mb-2 block">🍩</span>
                    <span className="text-white/40">Engagement chart placeholder</span>
                    <p className="text-white/30 text-sm mt-2">Integrate with Chart.js or Recharts</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          {stats.recent_activity && stats.recent_activity.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <span>🔔</span> Recent Activity
              </h2>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="space-y-3">
                  {stats.recent_activity.map((activity, index) => (
                    <ActivityItem
                      key={index}
                      icon={activity.icon || '🔸'}
                      text={activity.text}
                      time={activity.time}
                      color={activity.color || 'violet'}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span>⚡</span> Quick Actions
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Link
                to="/admin/users"
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors text-center"
              >
                <span className="text-2xl mb-2 block">👥</span>
                <span className="text-white font-medium">Manage Users</span>
              </Link>
              <Link
                to="/admin/anime"
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors text-center"
              >
                <span className="text-2xl mb-2 block">🎬</span>
                <span className="text-white font-medium">Manage Anime</span>
              </Link>
              <Link
                to="/admin/import-jobs"
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors text-center"
              >
                <span className="text-2xl mb-2 block">📥</span>
                <span className="text-white font-medium">Import Jobs</span>
              </Link>
              <Link
                to="/admin/reviews"
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors text-center"
              >
                <span className="text-2xl mb-2 block">⭐</span>
                <span className="text-white font-medium">Moderate Reviews</span>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-white/60">
          <span className="text-4xl mb-4">📊</span>
          <p>No report data available</p>
          <button
            onClick={fetchStats}
            className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminReports;
