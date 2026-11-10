import { formatDuration, getProgressPercent, getStatusBadge } from './importJobFormat';

/** The body of the job details modal. */
export default function ImportJobDetails({ selectedJob, selectedOfflineEnrichment, handleCancelJob, closeModal }) {
  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <span className="text-sm text-white/60">Status</span>
          <div className="mt-1">{getStatusBadge(selectedJob.status)}</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <span className="text-sm text-white/60">Source</span>
          <p className="text-white font-medium mt-1">{selectedJob.source}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <span className="text-sm text-white/60">Type</span>
          <p className="text-white font-medium mt-1">{selectedJob.source_type}</p>
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
  );
}
