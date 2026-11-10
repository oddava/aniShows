import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';
import { adminKeys } from '../../api/queries/admin';
import { useAdminQuery } from './hooks/useAdminQuery';
import {
  Users, Film, Heart, Activity, Download, RefreshCcw,
} from 'lucide-react';
import CustomSelect from '../../components/common/CustomSelect';
import { EmptyState, LoadingSpinner } from './components/reports/reportsShared';
import OverviewTab from './components/reports/OverviewReportTab';
import UsersTab from './components/reports/UsersReportTab';
import ContentTab from './components/reports/ContentReportTab';
import EngagementTab from './components/reports/EngagementReportTab';

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'content', label: 'Content', icon: Film },
  { key: 'engagement', label: 'Engagement', icon: Heart },
];

// ─── Main Component ──────────────────────────────────────────────────────────

const AdminReports = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [dateRange, setDateRange] = useState('30');
  const queryClient = useQueryClient();
  // Set by Refresh so the next request asks the API to rebuild its cached report.
  const forceRefresh = useRef(false);

  const reportKey = adminKeys.report(activeTab, dateRange);
  const report = useAdminQuery({
    queryKey: reportKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ type: activeTab, days: dateRange });
      if (forceRefresh.current) {
        forceRefresh.current = false;
        params.set('refresh', 'true');
      }
      return api.get(`/admin/reports/?${params}`, { signal }).then((response) => response.data);
    },
    // A new date range keeps the tab's current figures on screen while it loads,
    // but another tab's figures never stand in for this one's.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === activeTab ? previousData : undefined,
    errorLog: `Failed to fetch ${activeTab} report:`,
    errorToast: `Failed to load ${activeTab} report`,
  });
  const tabData = report.data ?? null;
  const isCurrentTabLoading = report.isFetching;

  const handleRefresh = () => {
    forceRefresh.current = true;
    // Drop the shown figures (as before) and fetch again with refresh=true.
    queryClient.resetQueries({ queryKey: reportKey, exact: true });
  };

  const exportMutation = useMutation({
    mutationFn: () => api.get('/admin/stats/export/'),
  });
  const exporting = exportMutation.isPending;

  const handleExport = async () => {
    try {
      const response = await exportMutation.mutateAsync();
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
    }
  };


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Analytics & Reports</h1>
          <p className="text-gray-400 mt-1">Platform performance, growth, and engagement metrics.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CustomSelect
            value={dateRange}
            onChange={(nextValue) => setDateRange(nextValue)}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
              { value: '365', label: 'Last year' },
            ]}
            triggerClassName="px-4 py-2.5 bg-white/5 rounded-xl text-sm font-medium hover:bg-white/10 focus-visible:ring-white/20"
            ariaLabel="Analytics date range"
          />
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
          isCurrentTabLoading && !tabData ? (
            <LoadingSpinner text="Analyzing platform data..." />
          ) : tabData ? (
            <OverviewTab stats={tabData} />
          ) : (
            <EmptyState onRetry={handleRefresh} />
          )
        )}
        {activeTab === 'users' && (
          <UsersTab data={tabData} loading={isCurrentTabLoading} />
        )}
        {activeTab === 'content' && (
          <ContentTab data={tabData} loading={isCurrentTabLoading} />
        )}
        {activeTab === 'engagement' && (
          <EngagementTab data={tabData} loading={isCurrentTabLoading} />
        )}
      </div>
    </div>
  );
};

export default AdminReports;
