import { useState } from 'react';
import api from '../../api/client';
import { adminKeys } from '../../api/queries/admin';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';
import CustomSelect from '../../components/common/CustomSelect';
import { useAdminList, useAdminMutation } from './hooks/useAdminQuery';
import { formatDuration, getProgressPercent, getStatusBadge } from './components/importJobs/importJobFormat';
import ImportJobDetails from './components/importJobs/ImportJobDetails';
import TriggerImportJobForm from './components/importJobs/TriggerImportJobForm';

const ACTIVE_STATUSES = ['pending', 'processing'];
const hasActiveJobs = (data) => (data?.results || []).some((job) => ACTIVE_STATUSES.includes(job.status));

const AdminImportJobs = () => {
  const FULL_CATALOG_LIMIT = 5000;
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Trigger modal state
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);
  const [triggerSource, setTriggerSource] = useState('offline_catalog');
  const [triggerSyncType, setTriggerSyncType] = useState('trending');
  const [triggerLimit, setTriggerLimit] = useState(50);
  const [triggerBatchSize, setTriggerBatchSize] = useState(100);
  const [triggerReleaseTag, setTriggerReleaseTag] = useState('latest');
  const [triggerImportLimit, setTriggerImportLimit] = useState('');
  const [triggerEnrichment, setTriggerEnrichment] = useState(true);

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'pending', label: 'Pending' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const { items: jobs, totalPages, isFetching: loading, refetch } = useAdminList({
    resource: 'import-jobs',
    params: {
      page,
      ...(statusFilter && { status: statusFilter }),
    },
    page,
    setPage,
    // Poll every 5 seconds while a job on this page is pending or processing.
    refetchInterval: (query) => (hasActiveJobs(query.state.data) ? 5000 : false),
    refetchIntervalInBackground: true,
    errorLog: 'Failed to fetch import jobs:',
    errorToast: 'Failed to load import jobs',
  });

  const invalidate = [adminKeys.resource('import-jobs')];
  const cancelMutation = useAdminMutation((jobId) => api.post(`/admin/import-jobs/${jobId}/cancel/`), { invalidate });
  const triggerMutation = useAdminMutation((payload) => api.post('/admin/import-jobs/trigger/', payload), { invalidate });
  const isTriggering = triggerMutation.isPending;

  const handleStatusChange = (newStatus) => {
    setStatusFilter(newStatus);
    setPage(1);
  };

  const handleCancelJob = async (jobId) => {
    if (!confirm('Are you sure you want to cancel this import job?')) {
      return;
    }
    try {
      await cancelMutation.mutateAsync(jobId);
      toast.success('Import job cancelled');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to cancel job');
    }
  };

  const handleTriggerJob = async (e) => {
    e.preventDefault();
    try {
      let payload;
      if (triggerSource === 'offline_catalog') {
        payload = {
          source: 'offline_catalog',
          release_tag: triggerReleaseTag || 'latest',
          import_limit: triggerImportLimit === '' ? null : Number(triggerImportLimit),
          enqueue_enrichment: triggerEnrichment,
        };
      } else if (triggerSource === 'anime_catalog') {
        payload = {
          source: 'anime_catalog',
          sync_type: triggerSyncType,
          limit: Number(triggerLimit),
        };
      } else if (triggerSource === 'jikan_enrichment') {
        payload = {
          source: 'jikan_enrichment',
          batch_size: Number(triggerBatchSize),
        };
      } else {
        payload = {
          source: 'offline_catalog',
          release_tag: triggerReleaseTag || 'latest',
          import_limit: triggerImportLimit === '' ? null : Number(triggerImportLimit),
          enqueue_enrichment: triggerEnrichment,
        };
      }

      await triggerMutation.mutateAsync(payload);
      toast.success('Import job triggered successfully');
      setIsTriggerModalOpen(false);
    } catch (err) {
      logger.error('Failed to trigger job:', err);
      toast.error(err.response?.data?.detail || 'Failed to trigger job');
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

  const handleTriggerSourceChange = (nextSource) => {
    setTriggerSource(nextSource);
    if (nextSource === 'jikan_trending') {
      setTriggerSyncType('trending');
      return;
    }
    if (nextSource === 'anime_catalog' && triggerSyncType === 'trending') {
      setTriggerSyncType('seasonal');
    }
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
          <span className="font-medium text-white">{item.source}</span>
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
            <span>▶️</span> Trigger Job
          </button>
          <button
            onClick={() => refetch()}
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
          <ImportJobDetails
            selectedJob={selectedJob}
            selectedOfflineEnrichment={selectedOfflineEnrichment}
            handleCancelJob={handleCancelJob}
            closeModal={closeModal}
          />
        )}
      </Modal>

      {/* Trigger Job Modal */}
      <Modal
        isOpen={isTriggerModalOpen}
        onClose={() => !isTriggering && setIsTriggerModalOpen(false)}
        title="Trigger New Job"
        size="medium"
      >
        <TriggerImportJobForm
          FULL_CATALOG_LIMIT={FULL_CATALOG_LIMIT}
          isTriggering={isTriggering}
          handleTriggerJob={handleTriggerJob}
          setIsTriggerModalOpen={setIsTriggerModalOpen}
          triggerSource={triggerSource}
          handleTriggerSourceChange={handleTriggerSourceChange}
          triggerSyncType={triggerSyncType}
          setTriggerSyncType={setTriggerSyncType}
          triggerLimit={triggerLimit}
          setTriggerLimit={setTriggerLimit}
          triggerBatchSize={triggerBatchSize}
          setTriggerBatchSize={setTriggerBatchSize}
          triggerReleaseTag={triggerReleaseTag}
          setTriggerReleaseTag={setTriggerReleaseTag}
          triggerImportLimit={triggerImportLimit}
          setTriggerImportLimit={setTriggerImportLimit}
          triggerEnrichment={triggerEnrichment}
          setTriggerEnrichment={setTriggerEnrichment}
        />
      </Modal>
    </div>
  );
};

export default AdminImportJobs;
