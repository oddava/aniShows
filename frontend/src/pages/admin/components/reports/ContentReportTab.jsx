import { useMemo } from 'react';
import {
  Film, Tv, Building2, Tags, TrendingUp, AlertTriangle, Database, Layers,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart as RechartsPieChart, Pie, Legend,
} from 'recharts';
import {
  CHART_COLORS, STATUS_COLORS,
  ChartCard, CustomTooltip, EmptyState, LoadingSpinner, StatCard, renderPieLabel,
} from './reportsShared';

// ─── Tab: Content ────────────────────────────────────────────────────────────

const ContentTab = ({ data, loading }) => {
  const statusData = useMemo(() => {
    const raw = data?.by_status;
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
    const raw = data?.by_type;
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
    if (!data?.top_genres || !Array.isArray(data.top_genres)) return [];
    return data.top_genres.map(item => ({
      name: item.name,
      anime: item.anime_count,
    }));
  }, [data]);

  const studioData = useMemo(() => {
    if (!data?.top_studios || !Array.isArray(data.top_studios)) return [];
    return data.top_studios.map(item => ({
      name: item.name,
      anime: item.anime_count,
    }));
  }, [data]);

  const contentTrendData = useMemo(() => {
    if (!data?.content_trend || !Array.isArray(data.content_trend)) return [];
    return data.content_trend.map(item => ({
      name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      added: item.count,
    }));
  }, [data]);

  const metadataHealth = data?.missing_metadata;

  if (loading) return <LoadingSpinner text="Loading content analytics..." />;
  if (!data) return <EmptyState onRetry={() => { }} />;

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

export default ContentTab;
