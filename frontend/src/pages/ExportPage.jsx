import { useState } from 'react';
import { getApiErrorMessage } from '../api/errors';
import { useNavigate } from 'react-router-dom';
import { importExportApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, X } from 'lucide-react';

/** One block of the preview: a title and a short, scrollable JSON excerpt. */
function PreviewBlock({ title, value, total, shown }) {
    return (
        <div>
            <h4 className="text-sm font-medium text-[var(--text-1)] mb-2">{title}</h4>
            <pre className="rounded-[var(--radius-md)] bg-white/[0.04] p-3 text-sm overflow-auto text-[var(--text-2)]">
                {JSON.stringify(value, null, 2)}
            </pre>
            {total > shown && (
                <p className="mt-2 text-sm text-[var(--text-3)]">...and {total - shown} more</p>
            )}
        </div>
    );
}

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

            setSuccess('Export downloaded.');
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

            const skipped = Number(response.headers?.['x-export-skipped']) || 0;
            setSuccess(skipped > 0
                ? `Export downloaded. ${skipped} ${skipped === 1 ? 'entry' : 'entries'} without a MyAnimeList ID ${skipped === 1 ? 'was' : 'were'} left out.`
                : 'Export downloaded.');
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
            // `{data: <object>}`; an older server sent the export as a JSON string.
            const response = await importExportApi.exportDataJSON();
            const exported = response.data?.data;
            setJsonPreview(typeof exported === 'string' ? JSON.parse(exported) : exported);
            setShowPreview(true);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load preview'));
        } finally {
            setLoading(false);
        }
    };

    const spinner = <RefreshCw aria-hidden="true" className="w-4 h-4 animate-spin motion-reduce:animate-none" />;

    return (
        <div className="page-container pt-6 pb-16 md:pt-10">
            <header>
                <h1 className="page-title">Export your data</h1>
                <p className="mt-1 text-sm text-[var(--text-2)]">
                    Download a copy of your list, favorites, reviews and profile.
                </p>
            </header>

            <div className="max-w-3xl">
                <div aria-live="polite">
                    {error && <p role="alert" className="mt-6 text-sm text-[var(--danger)]">{error}</p>}
                    {success && <p className="mt-6 text-sm text-[var(--text-1)]">{success}</p>}
                </div>

                <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <section className="panel flex flex-col">
                        <h2 className="section-title">JSON</h2>
                        <p className="mt-1 text-sm text-[var(--text-3)]">Everything</p>
                        <p className="mt-3 text-sm leading-relaxed text-[var(--text-2)]">
                            Your full list, favorites, reviews and profile in a machine-readable format.
                        </p>
                        <div className="mt-auto flex flex-wrap gap-2 pt-5">
                            <button
                                type="button"
                                onClick={handleExportJSON}
                                disabled={loading}
                                className="btn-primary text-sm"
                            >
                                {loading ? <>{spinner} Preparing...</> : 'Download JSON'}
                            </button>
                            <button
                                type="button"
                                onClick={handlePreviewJSON}
                                disabled={loading}
                                className="btn-ghost text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Preview data
                            </button>
                        </div>
                    </section>

                    <section className="panel flex flex-col">
                        <h2 className="section-title">MyAnimeList XML</h2>
                        <p className="mt-1 text-sm text-[var(--text-3)]">Your anime list only</p>
                        <p className="mt-3 text-sm leading-relaxed text-[var(--text-2)]">
                            Works with MyAnimeList and other sites that accept MAL imports.
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--text-3)]">
                            Entries without a MyAnimeList ID are left out of the XML, since other sites could not
                            match them. The JSON export includes every entry.
                        </p>
                        <div className="mt-auto pt-5">
                            <button
                                type="button"
                                onClick={handleExportXML}
                                disabled={loading}
                                className="btn-secondary text-sm"
                            >
                                {loading ? <>{spinner} Preparing...</> : 'Download XML'}
                            </button>
                        </div>
                    </section>
                </div>

                <section className="panel mt-6">
                    <h2 className="section-title">What’s in the export</h2>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                            <dt className="text-[15px] font-medium text-[var(--text-1)]">Anime list</dt>
                            <dd className="text-sm text-[var(--text-2)]">Every entry with its status, score and progress</dd>
                        </div>
                        <div>
                            <dt className="text-[15px] font-medium text-[var(--text-1)]">Favorites</dt>
                            <dd className="text-sm text-[var(--text-2)]">In the order you set</dd>
                        </div>
                        <div>
                            <dt className="text-[15px] font-medium text-[var(--text-1)]">Reviews</dt>
                            <dd className="text-sm text-[var(--text-2)]">With their ratings and text, plus episode ratings</dd>
                        </div>
                        <div>
                            <dt className="text-[15px] font-medium text-[var(--text-1)]">Profile</dt>
                            <dd className="text-sm text-[var(--text-2)]">Bio, social links, follows and privacy settings</dd>
                        </div>
                    </dl>

                    <h3 className="mt-8 text-[15px] font-medium text-[var(--text-1)]">Not included</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
                        Your password and sign-in tokens, messages and notifications, and anything the site
                        works out for you (recommendations, history). Exports are made when you ask and aren’t
                        kept afterwards.
                    </p>
                </section>
            </div>

            {showPreview && jsonPreview && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="export-preview-title"
                        className="bg-[var(--ink-1)] rounded-[var(--radius-lg)] max-w-4xl w-full max-h-[80vh] flex flex-col"
                    >
                        <div className="flex items-center justify-between py-2 pl-5 pr-2">
                            <h2 id="export-preview-title" className="section-title">Data preview</h2>
                            <button
                                type="button"
                                onClick={() => setShowPreview(false)}
                                aria-label="Close preview"
                                className="btn-ghost w-11 px-0"
                            >
                                <X aria-hidden="true" className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto px-5 pb-2 space-y-5">
                            <PreviewBlock title="Profile" value={jsonPreview.profile} total={0} shown={0} />
                            <PreviewBlock
                                title={`Anime list (${jsonPreview.anime_list?.length || 0} entries)`}
                                value={jsonPreview.anime_list?.slice(0, 3)}
                                total={jsonPreview.anime_list?.length || 0}
                                shown={3}
                            />
                            <PreviewBlock
                                title={`Favorites (${jsonPreview.favorites?.length || 0} entries)`}
                                value={jsonPreview.favorites?.slice(0, 3)}
                                total={jsonPreview.favorites?.length || 0}
                                shown={3}
                            />
                            <PreviewBlock
                                title={`Reviews (${jsonPreview.reviews?.length || 0} entries)`}
                                value={jsonPreview.reviews?.slice(0, 2)}
                                total={jsonPreview.reviews?.length || 0}
                                shown={2}
                            />
                        </div>

                        <div className="p-4 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setShowPreview(false)}
                                className="btn-secondary text-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExportPage;
