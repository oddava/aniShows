import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import { toast } from 'react-hot-toast';

const AdminLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState({
    by_level: {},
    by_type: {},
    total: 0,
    recent_errors: 0,
    error_rate: 0,
  });
  const [filters, setFilters] = useState({
    level: '',
    log_type: '',
    search: '',
    user: '',
    start_date: '',
    end_date: '',
  });
  const [selectedLog, setSelectedLog] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const refreshInterval = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page,
        ...(filters.level && { level: filters.level }),
        ...(filters.log_type && { log_type: filters.log_type }),
        ...(filters.search && { search: filters.search }),
        ...(filters.user && { user: filters.user }),
        ...(filters.start_date && { start_date: filters.start_date }),
        ...(filters.end_date && { end_date: filters.end_date }),
      });

      const response = await api.get(`/admin/logs/?${params}`);
      setLogs(response.data.results);
      setTotalPages(Math.ceil(response.data.count / 20));
    } catch (err) {
      console.error('Failed to fetch logs:', err);
      toast.error('Failed to load logs');
    }
  }, [page, filters]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await api.get('/admin/logs/stats/');
      setStats(response.data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchLogs(), fetchStats()]).then(() => setLoading(false));
  }, [fetchLogs, fetchStats]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    refreshInterval.current = setInterval(() => {
      fetchLogs();
      fetchStats();
    }, 30000);

    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
  }, [fetchLogs, fetchStats]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({
      level: '',
      log_type: '',
      search: '',
      user: '',
      start_date: '',
      end_date: '',
    });
    setPage(1);
  };

  const viewLogDetails = (log) => {
    setSelectedLog(log);
    setIsModalOpen(true);
  };

  const getLevelColor = (level) => {
    switch (level) {
      case 'DEBUG':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'INFO':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'WARNING':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'ERROR':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'CRITICAL':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      default:
        return 'bg-white/10 text-white/60 border-white/20';
    }
  };

  const getTypeIcon = (type) => {
    const icons = {
      'SYSTEM': '⚙️',
      'REQUEST': '🌐',
      'AUTH': '🔐',
      'ADMIN': '👑',
      'ERROR': '❌',
      'SECURITY': '🛡️',
    };
    return icons[type] || '📝';
  };

  const levels = ['', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
  const logTypes = ['', 'SYSTEM', 'REQUEST', 'AUTH', 'ADMIN', 'ERROR', 'SECURITY'];

  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">System Logs</h1>
        <div className="flex items-center gap-2 text-sm text-white/50">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          Live
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">🔍</span>
            <input
              type="text"
              placeholder="Search logs..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          {/* Level Filter */}
          <select
            value={filters.level}
            onChange={(e) => handleFilterChange('level', e.target.value)}
            className="px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          >
            <option value="" className="bg-gray-800">All Levels</option>
            {levels.slice(1).map((level) => (
              <option key={level} value={level} className="bg-gray-800">{level}</option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={filters.log_type}
            onChange={(e) => handleFilterChange('log_type', e.target.value)}
            className="px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          >
            <option value="" className="bg-gray-800">All Types</option>
            {logTypes.slice(1).map((type) => (
              <option key={type} value={type} className="bg-gray-800">{type}</option>
            ))}
          </select>

          {/* User Filter */}
          <input
            type="text"
            placeholder="User ID..."
            value={filters.user}
            onChange={(e) => handleFilterChange('user', e.target.value)}
            className="px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Date Range */}
          <div className="flex gap-2">
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => handleFilterChange('start_date', e.target.value)}
              className="flex-1 px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
            />
            <span className="flex items-center text-white/50">to</span>
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => handleFilterChange('end_date', e.target.value)}
              className="flex-1 px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <div className="flex justify-end">
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-white/60 hover:text-white transition-colors"
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {levels.slice(1).map((level) => (
          <div key={level} className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${
              level === 'DEBUG' ? 'text-gray-400' :
              level === 'INFO' ? 'text-blue-400' :
              level === 'WARNING' ? 'text-yellow-400' :
              level === 'ERROR' ? 'text-red-400' :
              'text-purple-400'
            }`}>
              {level}
            </div>
            <div className="text-2xl font-bold text-white">{stats.by_level[level] || 0}</div>
          </div>
        ))}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1">Total</div>
          <div className="text-2xl font-bold text-white">{stats.total}</div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500 mx-auto mb-4"></div>
            <p className="text-white/50">Loading logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">📄</div>
            <p className="text-white/50">No logs found matching your criteria</p>
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {logs.map((log) => (
              <div 
                key={log.id} 
                className="p-4 hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => viewLogDetails(log)}
              >
                <div className="flex items-start gap-4">
                  {/* Level Badge */}
                  <div className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold border ${getLevelColor(log.level)}`}>
                    {log.level}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white/90 break-words">{log.message}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-white/50">
                      <span className="flex items-center gap-1">
                        <span>{getTypeIcon(log.log_type)}</span>
                        {log.log_type}
                      </span>
                      {log.user && (
                        <span className="flex items-center gap-1">
                          <span>👤</span>
                          {log.user.username}
                        </span>
                      )}
                      {log.method && (
                        <span className="flex items-center gap-1">
                          <span>🌐</span>
                          {log.method} {log.path}
                        </span>
                      )}
                      {log.status_code && (
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          log.status_code < 400 ? 'bg-green-500/20 text-green-400' : 
                          log.status_code < 500 ? 'bg-yellow-500/20 text-yellow-400' : 
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {log.status_code}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <span>🕐</span>
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex items-center justify-between">
            <span className="text-sm text-white/50">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Auto-refresh indicator */}
      <div className="mt-4 flex items-center justify-center gap-2 text-sm text-white/40">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
        Auto-refresh enabled (30s)
      </div>

      {/* Log Details Modal */}
      {isModalOpen && selectedLog && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="w-full max-w-2xl bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 className="text-xl font-semibold text-white">Log Details</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${getLevelColor(selectedLog.level)}`}>
                  {selectedLog.level}
                </span>
                <span className="text-white/50">
                  {new Date(selectedLog.timestamp).toLocaleString()}
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/50 mb-1">Message</label>
                <p className="text-white p-3 bg-white/5 rounded-lg">{selectedLog.message}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/50 mb-1">Type</label>
                  <p className="text-white">{getTypeIcon(selectedLog.log_type)} {selectedLog.log_type}</p>
                </div>

                {selectedLog.user && (
                  <div>
                    <label className="block text-sm font-medium text-white/50 mb-1">User</label>
                    <p className="text-white">{selectedLog.user.username} (ID: {selectedLog.user.id})</p>
                  </div>
                )}

                {selectedLog.user_ip && (
                  <div>
                    <label className="block text-sm font-medium text-white/50 mb-1">IP Address</label>
                    <p className="text-white">{selectedLog.user_ip}</p>
                  </div>
                )}

                {selectedLog.method && (
                  <div>
                    <label className="block text-sm font-medium text-white/50 mb-1">Method</label>
                    <p className="text-white">{selectedLog.method}</p>
                  </div>
                )}

                {selectedLog.path && (
                  <div>
                    <label className="block text-sm font-medium text-white/50 mb-1">Path</label>
                    <p className="text-white font-mono text-sm">{selectedLog.path}</p>
                  </div>
                )}

                {selectedLog.status_code && (
                  <div>
                    <label className="block text-sm font-medium text-white/50 mb-1">Status Code</label>
                    <span className={`px-2 py-1 rounded text-sm ${
                      selectedLog.status_code < 400 ? 'bg-green-500/20 text-green-400' : 
                      selectedLog.status_code < 500 ? 'bg-yellow-500/20 text-yellow-400' : 
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {selectedLog.status_code}
                    </span>
                  </div>
                )}

                {selectedLog.duration_ms && (
                  <div>
                    <label className="block text-sm font-medium text-white/50 mb-1">Duration</label>
                    <p className="text-white">{selectedLog.duration_ms}ms</p>
                  </div>
                )}
              </div>

              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-white/50 mb-1">Details</label>
                  <pre className="text-white/80 text-sm p-3 bg-white/5 rounded-lg overflow-auto max-h-48">
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLogs;
