import { useId, useState } from 'react';

import { importExportApi } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';

export const EXPORT_FORMATS = [
    {
        key: 'json',
        name: 'Everything',
        format: 'JSON',
        detail: 'Your list, episode ratings, favorites, reviews, follows and profile.',
        mime: 'application/json',
    },
    {
        key: 'xml',
        name: 'Anime list',
        format: 'MyAnimeList XML',
        detail: 'Imports into MyAnimeList, AniList and most other trackers.',
        mime: 'application/xml',
    },
    {
        key: 'csv',
        name: 'Anime list',
        format: 'CSV',
        detail: 'Opens in any spreadsheet app.',
        mime: 'text/csv',
    },
];

/** The server's file name (Content-Disposition), else a dated one. */
const fileNameFor = (response, username, ext) => {
    const header = response.headers?.['content-disposition'] ?? '';
    const match = header.match(/filename="?([^";]+)"?/i);
    if (match) return match[1];
    return `anishows_${username}_${new Date().toISOString().slice(0, 10)}.${ext}`;
};

const saveBlob = (data, mime, fileName) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
};

/** Export: three downloads in open formats, made on request and not kept. */
export default function ExportSection({ user }) {
    const ids = useId();
    const [pending, setPending] = useState(null);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');

    const download = async ({ key, mime }) => {
        setPending(key);
        setError('');
        setNote('');
        try {
            const response = await importExportApi.exportData(key);
            saveBlob(response.data, mime, fileNameFor(response, user.username, key));
            const skipped = Number(response.headers?.['x-export-skipped']) || 0;
            if (skipped > 0) {
                setNote(`${skipped} ${skipped === 1 ? 'title has' : 'titles have'} no MyAnimeList ID, so the XML file leaves ${skipped === 1 ? 'it' : 'them'} out. The JSON and CSV files include every title.`);
            }
        } catch (err) {
            setError(getApiErrorMessage(err, 'The file could not be made. Please try again.'));
        } finally {
            setPending(null);
        }
    };

    return (
        <section className="panel" aria-labelledby={`${ids}-title`}>
            <h2 id={`${ids}-title`} className="section-title">Export your data</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--text-2)]">
                Download a copy whenever you like. Files are made when you ask and aren’t kept.
            </p>

            <ul className="mt-4 divide-y divide-white/[0.06]">
                {EXPORT_FORMATS.map((item) => (
                    <li key={item.key} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                            <p className="text-[15px] text-[var(--text-1)]">
                                {item.name}
                                <span className="text-[var(--text-3)]"> · {item.format}</span>
                            </p>
                            <p className="text-sm text-[var(--text-2)]">{item.detail}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => download(item)}
                            disabled={pending !== null}
                            aria-label={`Download ${item.name.toLowerCase()} as ${item.format}`}
                            className="btn-secondary shrink-0 text-sm"
                        >
                            {pending === item.key ? 'Preparing...' : 'Download'}
                        </button>
                    </li>
                ))}
            </ul>

            <div aria-live="polite">
                {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
                {note && <p className="mt-3 text-sm text-[var(--text-2)]">{note}</p>}
            </div>

            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--text-3)]">
                Not included: your password and sign-in details, notifications, and things worked
                out for you, like recommendations.
            </p>
        </section>
    );
}
