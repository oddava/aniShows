import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { importExportApi } from '../api/client';
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
    X
} from 'lucide-react';

const normalizeJobsResponse = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && Array.isArray(payload.results)) {
        return payload.results;
    }

    return [];
};

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
    const [jobs, setJobs] = useState([]);
    const [expandedJob, setExpandedJob] = useState(null);
    const [cancellingJob, setCancellingJob] = useState(null);

    // Check authentication
    useEffect(() => {
        if (!user) {
            navigate('/login', { state: { from: '/import' } });
        }
    }, [user, navigate]);

    // Fetch jobs on mount
    useEffect(() => {
        if (user) {
            fetchJobs();
        }
    }, [user]);

    const fetchJobs = async () => {
        try {
            const response = await importExportApi.getImportJobs();
            setJobs(normalizeJobsResponse(response.data));
        } catch (err) {
            logger.error('Failed to fetch import jobs:', err);
        }
    };

    const pollJobStatus = useCallback(async (jobId) => {
        try {
            const response = await importExportApi.getImportJobStatus(jobId);
            const job = response.data;
            
            // Update jobs list
            setJobs((prevJobs) => {
                const jobsList = normalizeJobsResponse(prevJobs);
                const existingIndex = jobsList.findIndex((j) => j.id === jobId);

                if (existingIndex === -1) {
                    return [job, ...jobsList];
                }

                return jobsList.map((j) => (j.id === jobId ? job : j));
            });
            
            // Continue polling if job is still processing
            if (job.status === 'pending' || job.status === 'processing') {
                setTimeout(() => pollJobStatus(jobId), 2000);
            } else {
                // Job completed or failed
                if (job.status === 'completed') {
                    setSuccess(`Import completed! Imported: ${job.imported_entries}${job.fetched_entries ? ', Fetched: ' + job.fetched_entries : ''}, Skipped: ${job.skipped_entries}`);
                } else if (job.status === 'failed') {
                    setError(`Import failed: ${job.errors?.[0] || 'Unknown error'}`);
                }
            }
        } catch (err) {
            logger.error('Failed to poll job status:', err);
        }
    }, []);

    const handleCancelJob = async (jobId) => {
        setCancellingJob(jobId);
        try {
            await importExportApi.cancelImportJob(jobId);
            setSuccess('Import cancelled successfully');
            fetchJobs();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to cancel import');
        } finally {
            setCancellingJob(null);
        }
    };

    const handleMALImport = async (e) => {
        e.preventDefault();
        if (!malUsername.trim()) {
            setError('Please enter a MyAnimeList username');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await importExportApi.importMAL(malUsername.trim());
            const { job_id } = response.data;
            
            setSuccess('Import started! You can monitor the progress below.');
            fetchJobs();
            pollJobStatus(job_id);
            setMalUsername('');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to start import');
        } finally {
            setLoading(false);
        }
    };

    const handleAniListImport = async (e) => {
        e.preventDefault();
        if (!anilistUsername.trim()) {
            setError('Please enter an AniList username');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await importExportApi.importAniList(anilistUsername.trim());
            const { job_id } = response.data;
            
            setSuccess('Import started! You can monitor the progress below.');
            fetchJobs();
            pollJobStatus(job_id);
            setAnilistUsername('');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to start import');
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.xml')) {
            setSelectedFile(file);
            setError('');
        } else {
            setError('Please select a valid XML file');
            setSelectedFile(null);
        }
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
            const { job_id } = response.data;
            
            setSuccess('Import started! You can monitor the progress below.');
            fetchJobs();
            pollJobStatus(job_id);
            setSelectedFile(null);
            // Reset file input
            e.target.reset();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to start import');
        } finally {
            setLoading(false);
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed':
                return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'failed':
                return <AlertCircle className="w-5 h-5 text-red-500" />;
            case 'processing':
                return <RefreshCw className="w-5 h-5 text-accent animate-spin" />;
            default:
                return <Clock className="w-5 h-5 text-yellow-500" />;
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'completed':
                return 'bg-green-500/10 text-green-400 border border-green-500/20';
            case 'failed':
                return 'bg-red-500/10 text-red-400 border border-red-500/20';
            case 'processing':
                return 'bg-accent/10 text-accent border border-accent/20';
            default:
                return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
        }
    };

    const canCancel = (status) => status === 'pending' || status === 'processing';

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
                <div className="flex flex-col sm:flex-row border-b border-gray-800">
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
                                    className="px-6 py-2 bg-accent text-dark font-semibold rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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
                                Export your list from MyAnimeList (List {'->'} Export List) and upload the XML file here.
                                This works even for private lists.
                            </p>
                            <div className="space-y-4">
                                <div className="border-2 border-dashed border-gray-700 rounded-lg p-6 sm:p-8 text-center hover:border-accent/50 transition-colors bg-dark-50/50">
                                    <input
                                        type="file"
                                        accept=".xml"
                                        onChange={handleFileSelect}
                                        className="hidden"
                                        id="xml-file"
                                        disabled={loading}
                                    />
                                    <label 
                                        htmlFor="xml-file"
                                        className="cursor-pointer flex flex-col items-center"
                                    >
                                        <Upload className="w-10 h-10 sm:w-12 sm:h-12 text-gray-500 mb-3 sm:mb-4" />
                                        <span className="text-gray-300 text-sm sm:text-base px-2">
                                            {selectedFile ? selectedFile.name : 'Click to select XML file'}
                                        </span>
                                        <span className="text-xs sm:text-sm text-gray-500 mt-2">
                                            Maximum file size: 10MB
                                        </span>
                                    </label>
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading || !selectedFile}
                                    className="w-full px-6 py-2 bg-accent text-dark font-semibold rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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
                                Enter your AniList username to import your anime list.
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
                                    className="px-6 py-2 bg-accent text-dark font-semibold rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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

            {/* Import Jobs */}
            {jobs.length > 0 && (
                <div className="bg-dark-100 rounded-xl sm:rounded-2xl border border-gray-800 overflow-hidden">
                    <div className="p-4 sm:p-6 border-b border-gray-800">
                        <h2 className="text-lg sm:text-xl font-bold text-white">Import History</h2>
                    </div>
                    <div className="divide-y divide-gray-800">
                        {jobs.map((job) => (
                            <div key={job.id} className="p-3 sm:p-4">
                                <div 
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                                    onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                                >
                                    <div className="flex items-center gap-3 sm:gap-4">
                                        {getStatusIcon(job.status)}
                                        <div className="min-w-0">
                                            <p className="font-medium text-white text-sm sm:text-base">{job.source_display}</p>
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
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                        {/* Cancel button for pending/processing */}
                                        {canCancel(job.status) && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCancelJob(job.id);
                                                }}
                                                disabled={cancellingJob === job.id}
                                                className="px-2 sm:px-3 py-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-lg text-xs sm:text-sm hover:bg-yellow-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                                            >
                                                {cancellingJob === job.id ? (
                                                    <>
                                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                                        <span className="hidden sm:inline">Cancelling...</span>
                                                        <span className="sm:hidden">...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <X className="w-3 h-3" />
                                                        <span className="hidden sm:inline">Cancel</span>
                                                    </>
                                                )}
                                            </button>
                                        )}
                                        
                                        <span className={`px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${getStatusColor(job.status)}`}>
                                            <span className="hidden sm:inline">{job.status_display}</span>
                                            <span className="sm:hidden">{job.status.charAt(0).toUpperCase() + job.status.slice(1)}</span>
                                        </span>
                                        {job.status === 'processing' && (
                                            <span className="text-xs sm:text-sm text-gray-400">
                                                {job.progress_percentage}%
                                            </span>
                                        )}
                                        {expandedJob === job.id ? (
                                            <ChevronUp className="w-5 h-5 text-gray-500" />
                                        ) : (
                                            <ChevronDown className="w-5 h-5 text-gray-500" />
                                        )}
                                    </div>
                                </div>
                                
                                {expandedJob === job.id && (
                                    <div className="mt-4 pt-4 border-t border-gray-800">
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
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportPage;
