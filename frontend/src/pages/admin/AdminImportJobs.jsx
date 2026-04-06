import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';
import CustomSelect from '../../components/common/CustomSelect';

const AdminImportJobs = () => {
  const FULL_CATALOG_LIMIT = 5000;
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Trigger modal state
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);
  const [triggerSource, setTriggerSource] = useState('anilist_sync');
  const [triggerSyncType, setTriggerSyncType] = useState('trending');
  const [triggerLimit, setTriggerLimit] = useState(50);
  const [triggerReleaseTag, setTriggerReleaseTag] = useState('latest');
  const [triggerImportLimit, setTriggerImportLimit] = useState('');
  const [triggerEnrichment, setTriggerEnrichment] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'pending', label: 'Pending' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        ...(statusFilter && { status: statusFilter }),
      });

      const response = await api.get(`/admin/import-jobs/?${params}`);
      setJobs(response.data.results);
      setTotalPages(Math.ceil(response.data.count / 20));
    } catch (err) {
      logger.error('Failed to fetch import jobs:', err);
      toast.error('Failed to load import jobs');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh when there are active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(job => ['pending', 'processing'].includes(job.status));
    if (hasActiveJobs) {
      const interval = setInterval(fetchJobs, 5000);
      return () => clearInterval(interval);
    }
  }, [jobs, fetchJobs]);

  const handleStatusChange = (newStatus) => {
    setStatusFilter(newStatus);
    setPage(1);
  };

  const handleCancelJob = async (jobId) => {
    if (!confirm('Are you sure you want to cancel this import job?')) {
      return;
    }
    try {
      await api.post(`/admin/import-jobs/${jobId}/cancel/`);
      toast.success('Import job cancelled');
      fetchJobs();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to cancel job');
    }
  };

  const handleTriggerJob = async (e) => {
    e.preventDefault();
    setIsTriggering(true);
    try {
      const payload = triggerSource === 'offline_catalog'
        ? {
          source: 'offline_catalog',
          release_tag: triggerReleaseTag || 'latest',
          import_limit: triggerImportLimit === '' ? null : Number(triggerImportLimit),
          enqueue_enrichment: triggerEnrichment,
        }
        : {
          source: 'anilist_sync',
          sync_type: triggerSyncType,
          limit: Number(triggerLimit),
        };

      await api.post('/admin/import-jobs/trigger/', payload);
      toast.success('Import job triggered successfully');
      setIsTriggerModalOpen(false);
      fetchJobs();
    } catch (err) {
      logger.error('Failed to trigger job:', err);
      toast.error(err.response?.data?.detail || 'Failed to trigger job');
    } finally {
      setIsTriggering(false);
    }
  };

  const openJobDetails = (job) => {
    setSelectedJob(job);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedJob(null);
  };

  const getStatusBadge = (status) => {
    const statusStyles = {
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      completed: 'bg-green-500/20 text-green-400 border-green-500/30',
      failed: 'bg-red-500/20 text-red-400 border-red-500/30',
      cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full border ${statusStyles[status] || statusStyles.pending}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const getProgressPercent = (processed, total) => {
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.round((processed / total) * 100));
  };

  const selectedOfflineEnrichment = selectedJob?.metadata?.offline_import?.enrichment;

  const columns = [
    {
      key: 'id',
      title: 'ID',
      width: '80px',
      render: (item) => (
        <span className="text-white/60 font-mono text-sm">#{item.id}</span>
      ),
    },
    {
      key: 'source',
      title: 'Source',
      render: (item) => (
        <div>
          <span className="font-medium text-white capitalize">{item.source}</span>
          <span className="text-white/40 text-sm ml-2">({item.source_type})</span>
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (item) => getStatusBadge(item.status),
    },
    {
      key: 'progress',
      title: 'Progress',
      render: (item) => (
        <div className="w-full">
          <div className="flex justify-between text-xs text-white/60 mb-1">
            <span>{item.processed_items} / {item.total_items || '?'}</span>
            <span>{getProgressPercent(item.processed_items, item.total_items)}%</span>
          </div>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${item.status === 'failed' ? 'bg-red-500' :
                  item.status === 'completed' ? 'bg-green-500' :
                    'bg-violet-500'
                }`}
              style={{ width: `${getProgressPercent(item.processed_items, item.total_items)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'created_at',
      title: 'Created',
      render: (item) => (
        <span className="text-white/60 text-sm">
          {new Date(item.created_at).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'duration',
      title: 'Duration',
      render: (item) => (
        <span className="text-white/60 text-sm">
          {formatDuration(item.duration_seconds)}
        </span>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      sortable: false,
      render: (item) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => openJobDetails(item)}
            className="px-3 py-1.5 text-sm bg-violet-500/20 text-violet-400 rounded-lg hover:bg-violet-500/30 transition-colors"
          >
            Details
          </button>
          {['pending', 'processing'].includes(item.status) && (
            <button
              onClick={() => handleCancelJob(item.id)}
              className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Import Jobs Management</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsTriggerModalOpen(true)}
            className="px-4 py-2 bg-green-600/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-600/30 transition-colors flex items-center gap-2"
          >
            <span>▶️</span> Trigger Import
          </button>
          <button
            onClick={fetchJobs}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
          >
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-white/70 text-sm">Status:</label>
            <CustomSelect
              value={statusFilter}
              onChange={(nextValue) => handleStatusChange(nextValue)}
              options={statusOptions}
              triggerClassName="min-w-[180px] bg-white/10 px-4 py-2 rounded-lg focus-visible:ring-violet-500/50"
              ariaLabel="Filter import jobs by status"
            />
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <DataTable
          columns={columns}
          data={jobs}
          loading={loading}
          selectable={false}
          emptyMessage="No import jobs found"
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
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

      {/* Job Details Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`Import Job #${selectedJob?.id}`}
        size="large"
      >
        {selectedJob && (
          <div className="space-y-6">
            {/* Status Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <span className="text-sm text-white/60">Status</span>
                <div className="mt-1">{getStatusBadge(selectedJob.status)}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <span className="text-sm text-white/60">Source</span>
                <p className="text-white font-medium mt-1 capitalize">{selectedJob.source}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <span className="text-sm text-white/60">Type</span>
                <p className="text-white font-medium mt-1 capitalize">{selectedJob.source_type}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <span className="text-sm text-white/60">Duration</span>
                <p className="text-white font-medium mt-1">{formatDuration(selectedJob.duration_seconds)}</p>
              </div>
            </div>

            {/* Progress Details */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <h4 className="text-white font-medium mb-4">Progress</h4>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Processed Items</span>
                  <span className="text-white">{selectedJob.processed_items?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Total Items</span>
                  <span className="text-white">{selectedJob.total_items?.toLocaleString() || 'Unknown'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Success Rate</span>
                  <span className="text-green-400">
                    {selectedJob.processed_items > 0
                      ? Math.round(((selectedJob.processed_items - (selectedJob.error_count || 0)) / selectedJob.processed_items) * 100)
                      : 0}%
                  </span>
                </div>
                {selectedJob.error_count > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Errors</span>
                    <span className="text-red-400">{selectedJob.error_count}</span>
                  </div>
                )}
                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden mt-2">
                  <div
                    className={`h-full rounded-full ${selectedJob.status === 'failed' ? 'bg-red-500' :
                        selectedJob.status === 'completed' ? 'bg-green-500' :
                          'bg-violet-500'
                      }`}
                    style={{ width: `${getProgressPercent(selectedJob.processed_items, selectedJob.total_items)}%` }}
                  />
                </div>
              </div>
            </div>

            {selectedOfflineEnrichment && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <h4 className="text-white font-medium mb-4">Enrichment Progress</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/60">Overall</span>
                    <span className="text-white">
                      {selectedOfflineEnrichment.overall.completed} / {selectedOfflineEnrichment.overall.queued}
                      {selectedOfflineEnrichment.overall.completion_percent != null
                        ? ` (${selectedOfflineEnrichment.overall.completion_percent}%)`
                        : ''}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Metadata</span>
                    <span className="text-white">
                      {selectedOfflineEnrichment.metadata.completed} / {selectedOfflineEnrichment.metadata.queued}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Franchises</span>
                    <span className="text-white">
                      {selectedOfflineEnrichment.franchises.completed} / {selectedOfflineEnrichment.franchises.queued}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Themes</span>
                    <span className="text-white">
                      {selectedOfflineEnrichment.themes.completed} / {selectedOfflineEnrichment.themes.queued}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <span className="text-sm text-white/60">Created At</span>
                <p className="text-white font-medium mt-1">{new Date(selectedJob.created_at).toLocaleString()}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <span className="text-sm text-white/60">Updated At</span>
                <p className="text-white font-medium mt-1">{new Date(selectedJob.updated_at).toLocaleString()}</p>
              </div>
            </div>

            {/* Error Details */}
            {selectedJob.error_message && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <h4 className="text-red-400 font-medium mb-2">Error Details</h4>
                <pre className="text-red-300 text-sm whitespace-pre-wrap overflow-auto max-h-40">
                  {selectedJob.error_message}
                </pre>
              </div>
            )}

            {/* Metadata */}
            {selectedJob.metadata && Object.keys(selectedJob.metadata).length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <h4 className="text-white font-medium mb-2">Metadata</h4>
                <pre className="text-white/60 text-sm whitespace-pre-wrap overflow-auto max-h-40">
                  {JSON.stringify(selectedJob.metadata, null, 2)}
                </pre>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
              {['pending', 'processing'].includes(selectedJob.status) && (
                <button
                  onClick={() => {
                    handleCancelJob(selectedJob.id);
                    closeModal();
                  }}
                  className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  Cancel Job
                </button>
              )}
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Trigger Job Modal */}
      <Modal
        isOpen={isTriggerModalOpen}
        onClose={() => !isTriggering && setIsTriggerModalOpen(false)}
        title="Trigger New Import Job"
        size="medium"
      >
        <form onSubmit={handleTriggerJob} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Source
            </label>
            <CustomSelect
              value={triggerSource}
              onChange={(nextValue) => setTriggerSource(nextValue)}
              disabled={isTriggering}
              options={[
                { value: 'anilist_sync', label: 'AniList Sync' },
                { value: 'offline_catalog', label: 'Anime Offline Database' },
              ]}
              triggerClassName="w-full bg-dark-100 px-4 py-2 rounded-lg focus-visible:ring-violet-500/50"
              ariaLabel="Import source"
            />
          </div>
          {triggerSource === 'anilist_sync' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">
                  Sync Type
                </label>
                <CustomSelect
                  value={triggerSyncType}
                  onChange={(nextType) => {
                    setTriggerSyncType(nextType);
                    if (nextType === 'full_catalog') {
                      setTriggerLimit(FULL_CATALOG_LIMIT);
                    }
                  }}
                  disabled={isTriggering}
                  options={[
                    { value: 'trending', label: 'Trending Anime' },
                    { value: 'seasonal', label: 'Current Season' },
                    { value: 'next_season', label: 'Next Season' },
                    { value: 'airing', label: 'Currently Airing' },
                    { value: 'full_catalog', label: 'Full Catalog (top 5000)' },
                  ]}
                  triggerClassName="w-full bg-dark-100 px-4 py-2 rounded-lg focus-visible:ring-violet-500/50"
                  ariaLabel="AniList sync type"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">
                  Limit (Number of Anime)
                </label>
                <input
                  type="number"
                  min="1"
                  max={FULL_CATALOG_LIMIT}
                  value={triggerLimit}
                  onChange={(e) => setTriggerLimit(e.target.value)}
                  disabled={isTriggering}
                  className="w-full px-4 py-2 bg-dark-100 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">
                  Release Tag
                </label>
                <input
                  type="text"
                  value={triggerReleaseTag}
                  onChange={(e) => setTriggerReleaseTag(e.target.value)}
                  disabled={isTriggering}
                  placeholder="latest"
                  className="w-full px-4 py-2 bg-dark-100 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">
                  Import Limit (optional)
                </label>
                <input
                  type="number"
                  min="1"
                  value={triggerImportLimit}
                  onChange={(e) => setTriggerImportLimit(e.target.value)}
                  disabled={isTriggering}
                  placeholder="Leave blank to import full dataset"
                  className="w-full px-4 py-2 bg-dark-100 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
                />
              </div>
              <label className="flex items-center gap-2 text-white/80 text-sm">
                <input
                  type="checkbox"
                  checked={triggerEnrichment}
                  onChange={(e) => setTriggerEnrichment(e.target.checked)}
                  disabled={isTriggering}
                  className="rounded border-white/20 bg-dark-100"
                />
                Queue metadata enrichment after import (synopsis, characters, staff, stats)
              </label>
            </>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => setIsTriggerModalOpen(false)}
              disabled={isTriggering}
              className="px-4 py-2 bg-white/5 text-white/70 rounded-lg hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isTriggering}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isTriggering ? 'Triggering...' : 'Trigger Job'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default AdminImportJobs;
