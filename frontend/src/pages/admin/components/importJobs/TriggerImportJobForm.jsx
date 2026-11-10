import CustomSelect from '../../../../components/common/CustomSelect';

/** The form in the "Trigger New Job" modal; its state lives in AdminImportJobs. */
export default function TriggerImportJobForm({
  FULL_CATALOG_LIMIT,
  isTriggering,
  handleTriggerJob,
  setIsTriggerModalOpen,
  triggerSource,
  handleTriggerSourceChange,
  triggerSyncType,
  setTriggerSyncType,
  triggerLimit,
  setTriggerLimit,
  triggerBatchSize,
  setTriggerBatchSize,
  triggerReleaseTag,
  setTriggerReleaseTag,
  triggerImportLimit,
  setTriggerImportLimit,
  triggerEnrichment,
  setTriggerEnrichment,
}) {
  return (
    <form onSubmit={handleTriggerJob} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">
          Source
        </label>
        <CustomSelect
          value={triggerSource}
          onChange={handleTriggerSourceChange}
          disabled={isTriggering}
          options={[
            { value: 'offline_catalog', label: 'Anime Offline Database' },
            { value: 'anime_catalog', label: 'Anime Model Fields' },
            { value: 'jikan_enrichment', label: 'Jikan (self-hosted) Metadata' },
          ]}
          triggerClassName="w-full bg-dark-100 px-4 py-2 rounded-lg focus-visible:ring-violet-500/50"
          ariaLabel="Import source"
        />
      </div>
      {triggerSource === 'jikan_trending' ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          Trending refresh pulls the recent-updates feed from the self-hosted
          Jikan service and maps returned MAL IDs onto local anime rows.
        </div>
      ) : triggerSource === 'anime_catalog' ? (
        <>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Derived Slice
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
                { value: 'seasonal', label: 'Seasonal' },
                { value: 'airing', label: 'Airing' },
                { value: 'next_season', label: 'Next Season' },
                { value: 'full_catalog', label: 'Full Catalog (top 5000)' },
              ]}
              triggerClassName="w-full bg-dark-100 px-4 py-2 rounded-lg focus-visible:ring-violet-500/50"
              ariaLabel="Catalog slice type"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Limit (number of anime)
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
      ) : triggerSource === 'jikan_enrichment' ? (
        <>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Metadata enrichment pulls characters, staff, themes, and relations
            from the self-hosted Jikan service for existing MAL-linked anime rows.
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Batch Size
            </label>
            <input
              type="number"
              min="1"
              value={triggerBatchSize}
              onChange={(e) => setTriggerBatchSize(e.target.value)}
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
            Queue Jikan (self-hosted) enrichment after import (metadata, themes, relations)
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
  );
}
