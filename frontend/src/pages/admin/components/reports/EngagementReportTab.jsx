import { useMemo } from 'react';
import {
  Heart, Star, ListPlus, Target, Activity, BarChart3, BookOpen, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart as RechartsPieChart, Pie, Legend, LineChart, Line,
} from 'recharts';
import {
  LIST_STATUS_COLORS,
  ChartCard, CustomTooltip, EmptyState, LoadingSpinner, StatCard, TableRanking, renderPieLabel,
} from './reportsShared';

// ─── Tab: Engagement ─────────────────────────────────────────────────────────

const EngagementTab = ({ data, loading }) => {
  const ratingData = useMemo(() => {
    const raw = data?.reviews_by_rating;
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
    const raw = data?.list_by_status;
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
    if (!data?.reviews_trend || !Array.isArray(data.reviews_trend)) return [];
    const dateMap = {};
    data.reviews_trend.forEach(item => {
      const dateKey = item.date;
      if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, reviews: 0, favorites: 0 };
      dateMap[dateKey].reviews = item.count;
    });
    if (data?.favorites_trend && Array.isArray(data.favorites_trend)) {
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

  if (loading) return <LoadingSpinner text="Loading engagement analytics..." />;
  if (!data) return <EmptyState onRetry={() => { }} />;

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

export default EngagementTab;
