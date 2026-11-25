import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../api/errors';
import { useNavigate } from 'react-router-dom';
import { importExportApi } from '../api/client';
import {
    ACTIVE_IMPORT_STATUSES,
    FINISHED_IMPORT_STATUSES,
    anilistLinkKeys,
    anilistLinkQueries,
    importJobKeys,
    importJobQueries,
} from '../api/queries/importJobs';
import { listKeys } from '../api/queries/lists';
import { profileKeys, userKeys } from '../api/queries/profile';
import { useFreshError, useReportError } from '../hooks/useQueryErrorReport';
import { useAuth } from '../context/AuthContext';
import { formatDateTimeInUserTimezone } from '../utils/dateUtils';
import logger from '../utils/logger';
import {
    Upload,
    Globe,
    FileText,
    RefreshCw,
    CheckCircle,
    AlertCircle,
    Clock,
    ChevronDown,
    ChevronUp,
    X,
    Link2,
} from 'lucide-react';

const MAX_XML_UPLOAD_BYTES = 10 * 1024 * 1024;
const XML_FILE_PATTERN = /\.(xml|xml\.gz|gz)$/i;

/** Why a picked file cannot be uploaded, or null when it can. */
export const validateXmlFile = (file) => {
    if (!file || !XML_FILE_PATTERN.test(file.name)) {
        return 'Please select a MyAnimeList export (.xml or .xml.gz)';
    }
    if (file.size > MAX_XML_UPLOAD_BYTES) {
        return 'File size must be less than 10MB';
    }
    return null;
};

/** The reason a job stopped: the fatal reason, else the last error recorded. */
export const jobFailureMessage = (job) => (
    job?.failure_reason || job?.errors?.[job.errors.length - 1] || 'Unknown error'
);

const UNMATCHED_REASON_LABELS = {
    not_in_catalog_yet: 'Not in the catalog yet (run the import again later)',
    not_found: 'Not found on AniList',
    unknown_status: 'Unknown list status',
    invalid: 'Invalid entry',
};

/** Sources whose import can be started again from the username alone. */
const RERUNNABLE_SOURCES = ['mal_api', 'anilist'];

const isActiveJob = (job) => ACTIVE_IMPORT_STATUSES.includes(job?.status);

/** Everything an import may have changed: lists (and their summaries), the own profile, Home's shelf. */
const refreshListViews = (queryClient) => Promise.all([
    queryClient.invalidateQueries({ queryKey: listKeys.all }),
    queryClient.invalidateQueries({ queryKey: profileKeys.own }),
    queryClient.invalidateQueries({ queryKey: userKeys.watching }),
]);

/**
 * The jobs list with the polled jobs folded in: a polled job missing from the
 * list goes on top, and a polled reading replaces the list's copy when it is
 * the newer of the two (whichever answered last wins, as with the old setJobs).
 */
const mergePolledJobs = (jobs, listUpdatedAt, polledJobIds, polledResults) => {
    let merged = jobs;
    polledJobIds.forEach((jobId, index) => {
        const result = polledResults[index];
        const job = result?.data;
        if (!job) return;
        const existingIndex = merged.findIndex((j) => j.id === jobId);
        if (existingIndex === -1) {
            merged = [job, ...merged];
        } else if (result.dataUpdatedAt >= listUpdatedAt) {
            merged = merged.map((j) => (j.id === jobId ? job : j));
        }
    });
    return merged;
};

const EMPTY_JOBS = [];

const ImportPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('mal');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Form states
    const [malUsername, setMalUsername] = useState('');
    const [anilistUsername, setAnilistUsername] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    
    // Jobs state
    const [expandedJob, setExpandedJob] = useState(null);
    const queryClient = useQueryClient();
    const userId = user?.id;

    // Check authentication
    useEffect(() => {
        if (!user) {
            navigate('/login', { state: { from: '/import' } });
        }
    }, [user, navigate]);

    // The user's jobs, loaded on mount.
    const jobsQuery = useQuery({
        ...importJobQueries.list(userId),
        enabled: !!user,
        staleTime: 0,
        retry: false,
    });
    useReportError(
        useFreshError(jobsQuery, importJobKeys.list(userId)),
        jobsQuery.errorUpdatedAt,
        { log: 'Failed to fetch import jobs:' },
    );

    // Jobs started on this page, polled every 2 seconds until they finish.
    const [polledJobIds, setPolledJobIds] = useState([]);
    const polledResults = useQueries({
        queries: polledJobIds.map((jobId) => ({
            ...importJobQueries.status(userId, jobId),
            refetchIntervalInBackground: true,
            staleTime: 0,
            retry: false,
        })),
    });
    // Log each failed poll once, like the old poll loop (which then stopped).
    const loggedPollErrors = useRef(new Map());
    useEffect(() => {
        polledResults.forEach((result, index) => {
            const jobId = polledJobIds[index];
            if (!result.error || loggedPollErrors.current.get(jobId) === result.errorUpdatedAt) return;
            loggedPollErrors.current.set(jobId, result.errorUpdatedAt);
            logger.error('Failed to poll job status:', result.error);
        });
    }, [polledResults, polledJobIds]);

    const jobs = useMemo(
        () => mergePolledJobs(jobsQuery.data ?? EMPTY_JOBS, jobsQuery.dataUpdatedAt, polledJobIds, polledResults),
        [jobsQuery.data, jobsQuery.dataUpdatedAt, polledJobIds, polledResults],
    );

    // Announce each polled job once, when it finishes, and refresh what it changed
    // (a failed or cancelled job may still have written some entries).
    const announcedJobs = useRef(new Set());
    useEffect(() => {
        polledResults.forEach((result) => {
            const job = result.data;
            if (!job || announcedJobs.current.has(job.id)) return;
            if (!FINISHED_IMPORT_STATUSES.includes(job.status)) return;
            announcedJobs.current.add(job.id);
            refreshListViews(queryClient);
            queryClient.invalidateQueries({ queryKey: anilistLinkKeys.forUser(userId) });
            if (job.status === 'completed') {
                setSuccess(`Import completed! Imported: ${job.imported_entries}${job.fetched_entries ? ', Fetched: ' + job.fetched_entries : ''}, Skipped: ${job.skipped_entries}`);
            } else if (job.status === 'cancelled') {
                setSuccess(`Import cancelled. ${job.processed_entries} of ${job.total_entries} entries were processed.`);
            } else {
                setError(`Import failed: ${jobFailureMessage(job)}`);
            }
        });
    }, [polledResults, queryClient, userId]);

    const hasActiveJob = jobs.some(isActiveJob);

    const fetchJobs = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: importJobKeys.list(userId) });
    }, [queryClient, userId]);

    const pollJobStatus = useCallback((jobId) => {
        setPolledJobIds((ids) => (ids.includes(jobId) ? ids : [...ids, jobId]));
    }, []);

    // Jobs that were already running when the page opened (started before a reload,
    // from another tab, or the daily AniList sync) are polled the same way, so their
    // cards, Cancel and the Sync/Run again buttons follow them to the end.
    useEffect(() => {
        (jobsQuery.data ?? EMPTY_JOBS).filter(isActiveJob).forEach((job) => pollJobStatus(job.id));
    }, [jobsQuery.data, pollJobStatus]);

    const cancelMutation = useMutation({
        mutationFn: (jobId) => importExportApi.cancelImportJob(jobId),
        // The list and any polled copy of the job.
        onSuccess: () => queryClient.invalidateQueries({ queryKey: importJobKeys.forUser(userId) }),
    });
    const cancellingJob = cancelMutation.isPending ? cancelMutation.variables : null;

    const handleCancelJob = async (jobId) => {
        try {
            await cancelMutation.mutateAsync(jobId);
            setSuccess('Import cancelled successfully');
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to cancel import'));
        }
    };

    /** Start a username import (`mal_api` or `anilist`); true when it was queued. */
    const startUsernameImport = async (source, username) => {
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = source === 'anilist'
                ? await importExportApi.importAniList(username)
                : await importExportApi.importMAL(username);
            setSuccess('Import started! You can monitor the progress below.');
            trackJob(response.data.job_id);
            return true;
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to start import'));
            return false;
        } finally {
            setLoading(false);
        }
    };

    const trackJob = (jobId) => {
        fetchJobs();
        if (jobId) pollJobStatus(jobId);
    };

    const handleMALImport = async (e) => {
        e.preventDefault();
        if (!malUsername.trim()) {
            setError('Please enter a MyAnimeList username');
            return;
        }
        if (await startUsernameImport('mal_api', malUsername.trim())) {
            setMalUsername('');
        }
    };

    const handleAniListImport = async (e) => {
        e.preventDefault();
        if (!anilistUsername.trim()) {
            setError('Please enter an AniList username');
            return;
        }
        if (await startUsernameImport('anilist', anilistUsername.trim())) {
            setAnilistUsername('');
        }
    };

    const handleRunAgain = (job) => startUsernameImport(job.source, job.source_identifier);

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        const fileError = validateXmlFile(file);
        if (fileError) {
            setError(fileError);
            setSelectedFile(null);
            return;
        }
        setSelectedFile(file);
        setError('');
    };

    const handleXMLImport = async (e) => {
        e.preventDefault();
        if (!selectedFile) {
            setError('Please select an XML file');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await importExportApi.importMALXML(selectedFile);
            setSuccess('Import started! You can monitor the progress below.');
            trackJob(response.data.job_id);
            setSelectedFile(null);
            // Reset file input
            e.target.reset();
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to start import'));
        } finally {
            setLoading(false);
        }
    };

    if (!user) return null;

    return (
        <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-4xl">
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Import Anime List</h1>
            <p className="text-sm sm:text-base text-gray-400 mb-6 sm:mb-8">
                Import your anime list from MyAnimeList or AniList to get started quickly.
            </p>

            {error && (
                <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg flex items-center justify-between gap-2">
                    <span className="text-sm sm:text-base">{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 shrink-0">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {success && (
                <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg flex items-center justify-between gap-2">
                    <span className="text-sm sm:text-base">{success}</span>
                    <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-300 shrink-0">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Import Tabs */}
            <div className="bg-dark-100 rounded-2xl border border-gray-800 overflow-hidden mb-8">
                <div className="flex flex-col sm:flex-row ">
                    <button
                        className={`flex-1 py-3 sm:py-4 px-4 sm:px-6 text-center font-medium flex items-center justify-center gap-2 transition-colors text-sm sm:text-base ${
                            activeTab === 'mal' 
                                ? 'bg-dark-50 text-accent border-b-2 border-accent' 
                                : 'text-gray-400 hover:text-white hover:bg-dark-50/50'
                        }`}
                        onClick={() => setActiveTab('mal')}
                    >
                        <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">MyAnimeList (API)</span>
                        <span className="sm:hidden">MAL API</span>
                    </button>
                    <button
                        className={`flex-1 py-3 sm:py-4 px-4 sm:px-6 text-center font-medium flex items-center justify-center gap-2 transition-colors text-sm sm:text-base ${
                            activeTab === 'mal_xml' 
                                ? 'bg-dark-50 text-accent border-b-2 border-accent' 
                                : 'text-gray-400 hover:text-white hover:bg-dark-50/50'
                        }`}
                        onClick={() => setActiveTab('mal_xml')}
                    >
                        <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">MyAnimeList (XML)</span>
                        <span className="sm:hidden">MAL XML</span>
                    </button>
                    <button
                        className={`flex-1 py-3 sm:py-4 px-4 sm:px-6 text-center font-medium flex items-center justify-center gap-2 transition-colors text-sm sm:text-base ${
                            activeTab === 'anilist' 
                                ? 'bg-dark-50 text-accent border-b-2 border-accent' 
                                : 'text-gray-400 hover:text-white hover:bg-dark-50/50'
                        }`}
                        onClick={() => setActiveTab('anilist')}
                    >
                        <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
                        AniList
                    </button>
                </div>

                <div className="p-4 sm:p-6">
                    {activeTab === 'mal' && (
                        <form onSubmit={handleMALImport}>
                            <h3 className="text-lg font-semibold text-white mb-4">
                                Import from MyAnimeList (Public List)
                            </h3>
                            <p className="text-sm text-gray-400 mb-4">
                                Enter your MyAnimeList username to import your public anime list.
                                Make sure your list is set to public in your MAL privacy settings.
                            </p>
                            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                                <input
                                    type="text"
                                    value={malUsername}
                                    onChange={(e) => setMalUsername(e.target.value)}
                                    placeholder="MyAnimeList username"
                                    className="flex-1 px-4 py-2 bg-dark-50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                                    disabled={loading}
                                />
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-2 bg-accent-dark text-dark font-semibold rounded-lg hover:bg-accent-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                                >
                                    {loading ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            <span className="hidden sm:inline">Starting...</span>
                                            <span className="sm:hidden">...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-4 h-4" />
                                            Import
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}

                    {activeTab === 'mal_xml' && (
                        <form onSubmit={handleXMLImport}>
                            <h3 className="text-lg font-semibold text-white mb-4">
                                Import from MyAnimeList XML Export
                            </h3>
                            <p className="text-sm text-gray-400 mb-4">
                                Export your list from MyAnimeList (List {'->'} Export List) and upload the file here,
                                as it downloads (.xml.gz) or unpacked (.xml). This works even for private lists.
                            </p>
                            <div className="space-y-4">
                                <div className="border-2 border-dashed border-gray-700 rounded-lg p-6 sm:p-8 text-center hover:border-accent/50 transition-colors bg-dark-50/50">
                                    <input
                                        type="file"
                                        accept=".xml,.gz,application/xml,application/gzip"
                                        onChange={handleFileSelect}
                                        className="hidden"
                                        id="xml-file"
                                        data-testid="xml-file-input"
                                        disabled={loading}
                                    />
                                    <label 
                                        htmlFor="xml-file"
                                        className="cursor-pointer flex flex-col items-center"
                                    >
                                        <Upload className="w-10 h-10 sm:w-12 sm:h-12 text-gray-500 mb-3 sm:mb-4" />
                                        <span className="text-gray-300 text-sm sm:text-base px-2">
                                            {selectedFile ? selectedFile.name : 'Click to select an .xml or .xml.gz file'}
                                        </span>
                                        <span className="text-xs sm:text-sm text-gray-500 mt-2">
                                            Maximum file size: 10MB
                                        </span>
                                    </label>
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading || !selectedFile}
                                    className="w-full px-6 py-2 bg-accent-dark text-dark font-semibold rounded-lg hover:bg-accent-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                                >
                                    {loading ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-4 h-4" />
                                            Import from XML
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}

                    {activeTab === 'anilist' && (
                        <form onSubmit={handleAniListImport}>
                            <h3 className="text-lg font-semibold text-white mb-4">
                                Import from AniList
                            </h3>
                            <p className="text-sm text-gray-400 mb-4">
                                Enter your AniList username to import your anime list once. The list must be public.
                                To keep it in sync, link your account below instead.
                            </p>
                            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                                <input
                                    type="text"
                                    value={anilistUsername}
                                    onChange={(e) => setAnilistUsername(e.target.value)}
                                    placeholder="AniList username"
                                    className="flex-1 px-4 py-2 bg-dark-50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                                    disabled={loading}
                                />
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-2 bg-accent-dark text-dark font-semibold rounded-lg hover:bg-accent-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                                >
                                    {loading ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            <span className="hidden sm:inline">Starting...</span>
                                            <span className="sm:hidden">...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-4 h-4" />
                                            Import
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>

            <AniListLinkCard
                userId={userId}
                hasActiveJob={hasActiveJob}
                onJobStarted={trackJob}
                onSuccess={setSuccess}
                onError={setError}
            />

            {/* Import Jobs */}
            {jobs.length > 0 && (
                <div className="bg-dark-100 rounded-xl sm:rounded-2xl border border-gray-800 overflow-hidden">
                    <div className="p-4 sm:p-6 ">
                        <h2 className="text-lg sm:text-xl font-bold text-white">Import History</h2>
                    </div>
                    <div className=" ">
                        {jobs.map((job) => (
                            <ImportJobCard
                                key={job.id}
                                job={job}
                                expanded={expandedJob === job.id}
                                onToggle={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                                onCancel={() => handleCancelJob(job.id)}
                                cancelling={cancellingJob === job.id}
                                onRunAgain={() => handleRunAgain(job)}
                                runAgainDisabled={loading || hasActiveJob}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const STATUS_ICONS = {
    completed: <CheckCircle className="w-5 h-5 text-green-500" />,
    failed: <AlertCircle className="w-5 h-5 text-red-500" />,
    cancelled: <X className="w-5 h-5 text-gray-400" />,
    processing: <RefreshCw className="w-5 h-5 text-accent animate-spin" />,
    pending: <Clock className="w-5 h-5 text-yellow-500" />,
};

const STATUS_COLORS = {
    completed: 'bg-green-500/10 text-green-400 border border-green-500/20',
    failed: 'bg-red-500/10 text-red-400 border border-red-500/20',
    cancelled: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    processing: 'bg-accent/10 text-accent border border-accent/20',
    pending: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
};

const statusLabel = (job) => job.status_display || (job.status.charAt(0).toUpperCase() + job.status.slice(1));

function ImportJobCard({ job, expanded, onToggle, onCancel, cancelling, onRunAgain, runAgainDisabled }) {
    const active = isActiveJob(job);
    const canRunAgain = !active && RERUNNABLE_SOURCES.includes(job.source) && !!job.source_identifier;
    const progress = Math.min(Math.max(Number(job.progress_percentage) || 0, 0), 100);
    const unmatched = Array.isArray(job.unmatched) ? job.unmatched : [];

    return (
        <div className="p-3 sm:p-4" data-testid={`import-job-${job.id}`}>
            <div
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                onClick={onToggle}
            >
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    {STATUS_ICONS[job.status] || STATUS_ICONS.pending}
                    <div className="min-w-0">
                        <p className="font-medium text-white text-sm sm:text-base">
                            {job.source_display}
                            {job.mode === 'incremental' && <span className="ml-2 text-xs text-gray-500">Sync</span>}
                        </p>
                        <p className="text-xs sm:text-sm text-gray-500">
                            {formatDateTimeInUserTimezone(job.created_at, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                timeZoneName: 'short',
                            })}
                        </p>
                        {job.status === 'failed' && (
                            <p className="text-xs sm:text-sm text-red-400 mt-1">{jobFailureMessage(job)}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    {active && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCancel();
                            }}
                            disabled={cancelling}
                            className="px-2 sm:px-3 py-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-lg text-xs sm:text-sm hover:bg-yellow-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            {cancelling ? (
                                <>
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    <span>Cancelling...</span>
                                </>
                            ) : (
                                <>
                                    <X className="w-3 h-3" />
                                    <span>Cancel</span>
                                </>
                            )}
                        </button>
                    )}
                    {canRunAgain && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRunAgain();
                            }}
                            disabled={runAgainDisabled}
                            className="px-2 sm:px-3 py-1 bg-dark-50 text-gray-300 border border-gray-700 rounded-lg text-xs sm:text-sm hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                            <RefreshCw className="w-3 h-3" />
                            <span>Run again</span>
                        </button>
                    )}

                    <span className={`px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${STATUS_COLORS[job.status] || STATUS_COLORS.pending}`}>
                        {statusLabel(job)}
                    </span>
                    {job.status === 'processing' && (
                        <span className="text-xs sm:text-sm text-gray-400">
                            {progress}%
                        </span>
                    )}
                    {expanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-500" />
                    ) : (
                        <ChevronDown className="w-5 h-5 text-gray-500" />
                    )}
                </div>
            </div>

            {active && (
                <div className="mt-3">
                    <div
                        className="h-1.5 bg-dark-200 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-label="Import progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                    >
                        <div className="progress-fill h-full bg-accent-dark" style={{ '--progress': progress / 100 }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                        {job.processed_entries} of {job.total_entries || '?'} entries
                    </p>
                </div>
            )}

            {expanded && (
                <div className="mt-4 pt-4 ">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4">
                        <div className="text-center p-2 sm:p-3 bg-dark-50 rounded-lg border border-gray-800">
                            <p className="text-xl sm:text-2xl font-bold text-white">{job.total_entries}</p>
                            <p className="text-xs sm:text-sm text-gray-400">Total</p>
                        </div>
                        <div className="text-center p-2 sm:p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                            <p className="text-xl sm:text-2xl font-bold text-green-400">{job.imported_entries}</p>
                            <p className="text-xs sm:text-sm text-gray-400">Imported</p>
                        </div>
                        <div className="text-center p-2 sm:p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                            <p className="text-xl sm:text-2xl font-bold text-yellow-400">{job.skipped_entries}</p>
                            <p className="text-xs sm:text-sm text-gray-400">Skipped</p>
                        </div>
                        <div className="text-center p-2 sm:p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                            <p className="text-xl sm:text-2xl font-bold text-red-400">{job.failed_entries}</p>
                            <p className="text-xs sm:text-sm text-gray-400">Failed</p>
                        </div>
                    </div>

                    {job.source_identifier && (
                        <p className="text-sm text-gray-400 mb-2">
                            <span className="text-gray-300">Source:</span> {job.source_identifier}
                        </p>
                    )}
                    {job.skipped_entries > 0 && (
                        <p className="text-xs text-gray-500 mb-2">
                            Skipped entries were unchanged, or edited here more recently than on the source.
                        </p>
                    )}

                    {unmatched.length > 0 && (
                        <details className="mt-2">
                            <summary className="text-sm font-medium text-gray-300 cursor-pointer">
                                {unmatched.length} {unmatched.length === 1 ? 'title' : 'titles'} not matched
                            </summary>
                            <ul className="mt-2 space-y-1 text-sm text-gray-400">
                                {unmatched.map((item, idx) => (
                                    <li key={`${item.anilist_id || item.mal_id || item.title}-${idx}`}>
                                        <span className="text-gray-300">{item.title || 'Untitled'}</span>
                                        <span className="text-gray-500"> · {UNMATCHED_REASON_LABELS[item.reason] || item.reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}

                    {job.errors?.length > 0 && (
                        <div className="mt-2">
                            <p className="text-sm font-medium text-red-400 mb-1">Errors:</p>
                            <ul className="text-sm text-red-400 list-disc list-inside">
                                {job.errors.slice(0, 5).map((err, idx) => (
                                    <li key={idx}>{err}</li>
                                ))}
                                {job.errors.length > 5 && (
                                    <li>...and {job.errors.length - 5} more</li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function Switch({ checked, onChange, disabled, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => onChange(!checked)}
            disabled={disabled}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-100
            ${checked ? 'border-accent bg-accent-dark' : 'border-gray-700 bg-dark-50'}
            ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        >
            <span className={`h-5 w-5 rounded-full bg-white transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
    );
}

/** Re-render once `isoTime` has passed (the sync cooldown ending). */
function useNowUntil(isoTime) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const until = isoTime ? new Date(isoTime).getTime() : 0;
        const wait = until - Date.now();
        if (!(wait > 0)) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2 ** 31 - 1));
        return () => clearTimeout(timer);
    }, [isoTime]);
    return now;
}

const formatSyncTime = (iso) => formatDateTimeInUserTimezone(iso, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

/** Linked AniList account: pull-only sync (link, Sync now, opt-in daily sync, unlink). */
function AniListLinkCard({ userId, hasActiveJob, onJobStarted, onSuccess, onError }) {
    const queryClient = useQueryClient();
    const linkQuery = useQuery({ ...anilistLinkQueries.forUser(userId), enabled: !!userId, retry: false });
    const link = linkQuery.data;
    const [username, setUsername] = useState('');
    const [autoSync, setAutoSync] = useState(false);
    const now = useNowUntil(link?.sync_available_at);

    const refreshLink = () => queryClient.invalidateQueries({ queryKey: anilistLinkKeys.forUser(userId) });

    const saveMutation = useMutation({
        mutationFn: (values) => importExportApi.saveAniListLink(values).then((res) => res.data),
        onSuccess: (data) => {
            refreshLink();
            if (data?.job_id) {
                onJobStarted(data.job_id);
                onSuccess('AniList linked. Importing your list now.');
            } else if (data?.import_error?.detail) {
                onError(`AniList linked, but the import could not start: ${data.import_error.detail}`);
            }
        },
        onError: (err) => onError(getApiErrorMessage(err, 'Failed to link AniList')),
    });
    const syncMutation = useMutation({
        mutationFn: () => importExportApi.syncAniList().then((res) => res.data),
        onSuccess: (data) => {
            refreshLink();
            onJobStarted(data?.job_id);
            onSuccess('Sync started. Only entries changed on AniList are fetched.');
        },
        onError: (err) => {
            refreshLink();
            onError(getApiErrorMessage(err, 'Failed to start sync'));
        },
    });
    const unlinkMutation = useMutation({
        mutationFn: () => importExportApi.unlinkAniList(),
        onSuccess: () => {
            refreshLink();
            onSuccess('AniList unlinked. Your list was kept.');
        },
        onError: (err) => onError(getApiErrorMessage(err, 'Failed to unlink AniList')),
    });
    const busy = saveMutation.isPending || syncMutation.isPending || unlinkMutation.isPending;

    if (!userId || linkQuery.isLoading || linkQuery.isError) return null;

    const handleLink = (e) => {
        e.preventDefault();
        if (!username.trim()) {
            onError('Please enter an AniList username');
            return;
        }
        saveMutation.mutate({ username: username.trim(), autoSync });
    };

    const availableAt = link?.sync_available_at ? new Date(link.sync_available_at).getTime() : 0;
    const coolingDown = availableAt > now;
    const syncBlockedReason = hasActiveJob
        ? 'An import is already running.'
        : coolingDown
            ? `Available again at ${formatSyncTime(link.sync_available_at)}.`
            : '';

    return (
        <div className="bg-dark-100 rounded-2xl border border-gray-800 p-4 sm:p-6 mb-8" data-testid="anilist-link-card">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-gray-400" />
                Linked AniList
            </h2>

            {!link?.linked ? (
                <form onSubmit={handleLink}>
                    <p className="text-sm text-gray-400 mb-4">
                        Link your AniList username to import your public list now and pull changes later.
                        Nothing is ever written to AniList.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="AniList username"
                            aria-label="AniList username to link"
                            className="flex-1 px-4 py-2 bg-dark-50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                            disabled={busy}
                        />
                        <button
                            type="submit"
                            disabled={busy}
                            className="px-6 py-2 bg-accent-dark text-dark font-semibold rounded-lg hover:bg-accent-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                        >
                            <Link2 className="w-4 h-4" />
                            Link
                        </button>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                        <Switch checked={autoSync} onChange={setAutoSync} disabled={busy} label="Sync daily" />
                        <span className="text-sm text-gray-400">Sync daily</span>
                    </div>
                </form>
            ) : (
                <div className="space-y-4">
                    <div className="text-sm text-gray-400 space-y-1">
                        <p>
                            <span className="text-gray-300">Username:</span> {link.username}
                        </p>
                        <p>
                            <span className="text-gray-300">Last synced:</span>{' '}
                            {link.last_synced_at ? formatSyncTime(link.last_synced_at) : 'Never'}
                        </p>
                        {link.last_error && (
                            <p className="text-red-400">{link.last_error}</p>
                        )}
                        {link.auto_sync_paused && (
                            <p className="text-yellow-400">
                                Daily sync is paused after 5 failed syncs in a row. Turn it on again to resume.
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <Switch
                            checked={!!link.auto_sync && !link.auto_sync_paused}
                            onChange={(next) => saveMutation.mutate({ username: link.username, autoSync: next })}
                            disabled={busy}
                            label="Sync daily"
                        />
                        <span className="text-sm text-gray-400">Sync daily</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <button
                            type="button"
                            onClick={() => syncMutation.mutate()}
                            disabled={busy || !!syncBlockedReason}
                            className="px-6 py-2 bg-accent-dark text-dark font-semibold rounded-lg hover:bg-accent-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync now
                        </button>
                        <button
                            type="button"
                            onClick={() => unlinkMutation.mutate()}
                            disabled={busy}
                            className="px-4 py-2 bg-dark-50 text-gray-300 border border-gray-700 rounded-lg text-sm hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Unlink
                        </button>
                        {syncBlockedReason && (
                            <span className="text-xs text-gray-500">{syncBlockedReason}</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default ImportPage;
