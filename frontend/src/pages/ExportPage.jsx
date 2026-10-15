import { useState } from 'react';
import { getApiErrorMessage } from '../api/errors';
import { useNavigate } from 'react-router-dom';
import { importExportApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { 
    Download, 
    FileJson, 
    FileText, 
    Shield, 
    AlertCircle,
    CheckCircle,
    RefreshCw
} from 'lucide-react';

const ExportPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [jsonPreview, setJsonPreview] = useState(null);
    const [showPreview, setShowPreview] = useState(false);

    // Check authentication
    if (!user) {
        navigate('/login', { state: { from: '/export' } });
        return null;
    }

    const handleExportJSON = async () => {
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await importExportApi.exportData('json');
            
            // Create download link
            const blob = new Blob([response.data], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `anishows_export_${user.username}_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            
            setSuccess('Export downloaded successfully!');
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to export data'));
        } finally {
            setLoading(false);
        }
    };

    const handleExportXML = async () => {
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await importExportApi.exportData('xml');
            
            // Create download link
            const blob = new Blob([response.data], { type: 'application/xml' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `anishows_export_${user.username}_${new Date().toISOString().split('T')[0]}.xml`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            
            setSuccess('Export downloaded successfully!');
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to export data'));
        } finally {
            setLoading(false);
        }
    };

    const handlePreviewJSON = async () => {
        setLoading(true);
        setError('');

        try {
            const response = await importExportApi.exportDataJSON();
            setJsonPreview(JSON.parse(response.data.data));
            setShowPreview(true);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load preview'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            <h1 className="text-3xl font-bold text-white mb-2">Export Your Data</h1>
            <p className="text-gray-400 mb-8">
                Download a copy of your anime list, favorites, reviews, and profile data.
            </p>

            {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}

            {success && (
                <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            {/* Privacy Notice */}
            <div className="bg-dark-100 border border-gray-800 rounded-2xl p-6 mb-8">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-accent/10 rounded-xl">
                        <Shield className="w-6 h-6 text-accent" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-white mb-2">Your Data Privacy</h3>
                        <p className="text-gray-400 text-sm mb-2">
                            Your data belongs to you. We provide these export options to ensure 
                            you always have access to your information.
                        </p>
                        <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
                            <li>Exports include your anime list, favorites, reviews, and profile data</li>
                            <li>Your data is exported in standard formats (JSON/XML) for easy portability</li>
                            <li>Exports do not include your password or authentication tokens</li>
                            <li>Data is prepared on-demand and not stored after download</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Export Options */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
                {/* JSON Export */}
                <div className="bg-dark-100 rounded-2xl border border-gray-800 p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-3 bg-blue-500/10 rounded-xl">
                            <FileJson className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white">JSON Export</h3>
                            <p className="text-sm text-gray-500">Complete data export</p>
                        </div>
                    </div>
                    
                    <p className="text-gray-400 text-sm mb-4">
                        Download your complete data in JSON format. This includes all your anime lists, 
                        favorites, reviews, and profile information in a machine-readable format.
                    </p>
                    
                    <div className="space-y-2">
                        <button
                            onClick={handleExportJSON}
                            disabled={loading}
                            className="w-full px-4 py-2 bg-accent text-dark font-semibold rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                        >
                            {loading ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Preparing...
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4" />
                                    Download JSON
                                </>
                            )}
                        </button>
                        
                        <button
                            onClick={handlePreviewJSON}
                            disabled={loading}
                            className="w-full px-4 py-2 bg-dark-50 border border-gray-700 text-gray-300 rounded-lg hover:bg-dark-200 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Preview Data
                        </button>
                    </div>
                </div>

                {/* XML Export */}
                <div className="bg-dark-100 rounded-2xl border border-gray-800 p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-3 bg-green-500/10 rounded-xl">
                            <FileText className="w-6 h-6 text-green-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white">MAL XML Export</h3>
                            <p className="text-sm text-gray-500">Anime list only</p>
                        </div>
                    </div>
                    
                    <p className="text-gray-400 text-sm mb-4">
                        Download your anime list in MyAnimeList XML format. This format is compatible 
                        with other anime tracking platforms that support MAL imports.
                    </p>
                    
                    <button
                        onClick={handleExportXML}
                        disabled={loading}
                        className="w-full px-4 py-2 bg-green-500/20 text-green-400 font-semibold rounded-lg hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors border border-green-500/30"
                    >
                        {loading ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Preparing...
                            </>
                        ) : (
                            <>
                                <Download className="w-4 h-4" />
                                Download XML
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* JSON Preview Modal */}
            {showPreview && jsonPreview && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div className="bg-dark-100 rounded-2xl max-w-4xl w-full max-h-[80vh] flex flex-col border border-gray-800">
                        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">Data Preview</h3>
                            <button
                                onClick={() => setShowPreview(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                &times;
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-auto p-4">
                            <div className="space-y-4">
                                <div>
                                    <h4 className="font-medium text-gray-300 mb-2">Profile</h4>
                                    <pre className="bg-dark-50 border border-gray-800 p-3 rounded-lg text-sm overflow-auto text-gray-300">
                                        {JSON.stringify(jsonPreview.profile, null, 2)}
                                    </pre>
                                </div>
                                
                                <div>
                                    <h4 className="font-medium text-gray-300 mb-2">
                                        Anime List ({jsonPreview.anime_list?.length || 0} entries)
                                    </h4>
                                    <pre className="bg-dark-50 border border-gray-800 p-3 rounded-lg text-sm overflow-auto text-gray-300">
                                        {JSON.stringify(jsonPreview.anime_list?.slice(0, 3), null, 2)}
                                        {jsonPreview.anime_list?.length > 3 && (
                                            <div className="text-gray-500 mt-2">...and {jsonPreview.anime_list.length - 3} more</div>
                                        )}
                                    </pre>
                                </div>
                                
                                <div>
                                    <h4 className="font-medium text-gray-300 mb-2">
                                        Favorites ({jsonPreview.favorites?.length || 0} entries)
                                    </h4>
                                    <pre className="bg-dark-50 border border-gray-800 p-3 rounded-lg text-sm overflow-auto text-gray-300">
                                        {JSON.stringify(jsonPreview.favorites?.slice(0, 3), null, 2)}
                                        {jsonPreview.favorites?.length > 3 && (
                                            <div className="text-gray-500 mt-2">...and {jsonPreview.favorites.length - 3} more</div>
                                        )}
                                    </pre>
                                </div>
                                
                                <div>
                                    <h4 className="font-medium text-gray-300 mb-2">
                                        Reviews ({jsonPreview.reviews?.length || 0} entries)
                                    </h4>
                                    <pre className="bg-dark-50 border border-gray-800 p-3 rounded-lg text-sm overflow-auto text-gray-300">
                                        {JSON.stringify(jsonPreview.reviews?.slice(0, 2), null, 2)}
                                        {jsonPreview.reviews?.length > 2 && (
                                            <div className="text-gray-500 mt-2">...and {jsonPreview.reviews.length - 2} more</div>
                                        )}
                                    </pre>
                                </div>
                            </div>
                        </div>
                        
                        <div className="p-4 border-t border-gray-800 flex justify-end">
                            <button
                                onClick={() => setShowPreview(false)}
                                className="px-4 py-2 bg-dark-50 hover:bg-dark-200 text-gray-300 border border-gray-700 rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Data Retention Info */}
            <div className="bg-dark-100 rounded-2xl border border-gray-800 p-6">
                <h3 className="font-semibold text-white mb-4">What's Included in Your Export?</h3>
                
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-1">
                            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                        </div>
                        <div>
                            <p className="font-medium text-white">Anime List</p>
                            <p className="text-sm text-gray-400">All your anime entries with status, scores, and progress</p>
                        </div>
                    </div>
                    
                    <div className="flex items-start gap-3">
                        <div className="p-1">
                            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                        </div>
                        <div>
                            <p className="font-medium text-white">Favorites</p>
                            <p className="text-sm text-gray-400">Your favorite anime list with custom ordering</p>
                        </div>
                    </div>
                    
                    <div className="flex items-start gap-3">
                        <div className="p-1">
                            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                        </div>
                        <div>
                            <p className="font-medium text-white">Reviews</p>
                            <p className="text-sm text-gray-400">All your anime reviews with ratings and text</p>
                        </div>
                    </div>
                    
                    <div className="flex items-start gap-3">
                        <div className="p-1">
                            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                        </div>
                        <div>
                            <p className="font-medium text-white">Profile</p>
                            <p className="text-sm text-gray-400">Bio, social links, and privacy settings</p>
                        </div>
                    </div>
                </div>
                
                <div className="mt-6 pt-6 border-t border-gray-800">
                    <h4 className="font-medium text-white mb-2">Not Included:</h4>
                    <ul className="text-sm text-gray-400 space-y-1">
                        <li>Passwords or authentication credentials</li>
                        <li>Private messages or notifications</li>
                        <li>System-generated data (recommendations, history)</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default ExportPage;
