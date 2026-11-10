import { Link } from 'react-router-dom';
import {
  Activity, ArrowDownRight, ArrowUpRight, ChevronRight, Database, RefreshCcw,
} from 'lucide-react';

// Shared pieces of the admin analytics tabs.

// ─── Constants ───────────────────────────────────────────────────────────────

export const CHART_COLORS = [
  '#75698d', '#4f88a8', '#4f8d74', '#b88a52', '#b5626f',
  '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
  '#a855f7', '#22d3ee', '#34d399', '#fbbf24', '#fb7185',
];

export const STATUS_COLORS = {
  'Airing': '#10b981',
  'Finished': '#6366f1',
  'Upcoming': '#f59e0b',
  'Not Yet Aired': '#f97316',
  'Cancelled': '#ef4444',
};

export const LIST_STATUS_COLORS = {
  'Watching': '#75698d',
  'Completed': '#10b981',
  'On Hold': '#f59e0b',
  'Dropped': '#ef4444',
  'Plan to Watch': '#06b6d4',
};

// ─── Shared Components ───────────────────────────────────────────────────────

export const CustomTooltip = ({ active, payload, label }) => {
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

export const StatCard = ({ title, value, change, changeType, icon: Icon, link, linkText, colorClass, bgClass }) => (
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

export const ChartCard = ({ title, subtitle, icon: Icon, iconColor, iconBg, children, className = "" }) => (
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

export const TableRanking = ({ title, icon: Icon, iconColor, data, columns, emptyText = "No data available" }) => (
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

export const LoadingSpinner = ({ text = "Loading..." }) => (
  <div className="flex items-center justify-center min-h-[300px]">
    <div className="flex flex-col items-center">
      <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
      <p className="text-gray-400 font-medium text-sm animate-pulse">{text}</p>
    </div>
  </div>
);

export const EmptyState = ({ onRetry }) => (
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

export const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
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
