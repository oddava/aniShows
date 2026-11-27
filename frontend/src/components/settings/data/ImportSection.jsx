import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { importExportApi } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { anilistLinkKeys, anilistLinkQueries } from '../../../api/queries/importJobs';
import SettingsSwitch from '../SettingsSwitch';
import AniListLink from './AniListLink';
import ImportHistory from './ImportHistory';
import { SOURCES, parseListInput, usernameError, validateXmlFile } from './importHelpers';

/**
 * Import: pick the site, type (or paste a profile link to) a username, and go.
 * AniList imports link the account so later changes can be pulled; a private
 * MyAnimeList list comes in through its export file. History sits underneath.
 */
export default function ImportSection({ user, imports }) {
    const queryClient = useQueryClient();
    const ids = useId();
    const fileInput = useRef(null);
    const [picked, setPicked] = useState(null);
    const [username, setUsername] = useState('');
    const [keepInSync, setKeepInSync] = useState(true);
    const [error, setError] = useState('');

    const linkQuery = useQuery({ ...anilistLinkQueries.forUser(user.id), retry: false });
    const link = linkQuery.data?.linked ? linkQuery.data : null;
    const source = picked ?? (link ? 'anilist' : 'mal');
    const sourceLabel = SOURCES[source].label;

    const refreshLink = () => queryClient.invalidateQueries({ queryKey: anilistLinkKeys.forUser(user.id) });
    const started = () => {
        setError('');
        setUsername('');
        imports.track();
    };
    const failed = (fallback) => (err) => setError(getApiErrorMessage(err, fallback));

    const malMutation = useMutation({
        mutationFn: (name) => importExportApi.importMAL(name),
        onSuccess: started,
        onError: failed('The import could not start.'),
    });
    const fileMutation = useMutation({
        mutationFn: (file) => importExportApi.importMALXML(file),
        onSuccess: started,
        onError: failed('The file could not be read.'),
    });
    const linkMutation = useMutation({
        mutationFn: (values) => importExportApi.saveAniListLink(values).then((res) => res.data),
        onSuccess: (data) => {
            refreshLink();
            if (data?.job_id) started();
            else if (data?.import_error?.detail) {
                setError(`Linked, but the import could not start: ${data.import_error.detail}`);
            }
        },
        onError: failed('AniList could not be linked.'),
    });

    const verified = user.email_verified !== false;
    const busy = malMutation.isPending || fileMutation.isPending || linkMutation.isPending;
    const blocked = !verified || !!imports.running || busy;

    const handleInput = (value) => {
        setError('');
        const parsed = parseListInput(value);
        // A pasted profile link picks its site and keeps only the name.
        if (parsed.source) {
            setPicked(parsed.source);
            setUsername(parsed.username);
        } else {
            setUsername(value);
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        const name = parseListInput(username).username;
        const problem = usernameError(name, sourceLabel);
        if (problem) {
            setError(problem);
            return;
        }
        if (source === 'mal') malMutation.mutate(name);
        else linkMutation.mutate({ username: name, autoSync: keepInSync });
    };

    const handleFile = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const problem = validateXmlFile(file);
        if (problem) {
            setError(problem);
            return;
        }
        setError('');
        fileMutation.mutate(file);
    };

    const pick = (key) => {
        setPicked(key);
        setError('');
    };

    const showForm = source === 'mal' || !link;

    return (
        <section className="panel" aria-labelledby={`${ids}-title`}>
            <h2 id={`${ids}-title`} className="section-title">Import your list</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--text-2)]">
                Importing adds to your list and never removes anything. If you changed a title
                here more recently, your version is kept.
            </p>

            <div role="group" aria-label="Import from" className="mt-5 inline-flex gap-1 rounded-lg bg-white/[0.04] p-1">
                {Object.entries(SOURCES).map(([key, { label }]) => (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={source === key}
                        onClick={() => pick(key)}
                        className={`min-h-9 rounded-md px-3.5 text-sm font-medium transition-colors duration-150
                        ${source === key
                            ? 'bg-white/[0.08] text-[var(--text-1)]'
                            : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="mt-5 max-w-xl">
                {showForm ? (
                    <form onSubmit={handleSubmit} noValidate>
                        <label htmlFor={`${ids}-username`} className="block text-sm font-medium text-[var(--text-1)]">
                            {sourceLabel} username
                        </label>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                                id={`${ids}-username`}
                                type="text"
                                value={username}
                                onChange={(e) => handleInput(e.target.value)}
                                placeholder="Username or profile link"
                                autoComplete="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                aria-describedby={`${ids}-hint`}
                                aria-invalid={!!error || undefined}
                                className="input min-w-0 flex-1"
                                disabled={!verified}
                            />
                            <button type="submit" disabled={blocked} className="btn-primary">
                                {source === 'mal'
                                    ? (malMutation.isPending ? 'Starting...' : 'Import')
                                    : (linkMutation.isPending ? 'Linking...' : 'Import')}
                            </button>
                        </div>
                        <p id={`${ids}-hint`} className="mt-2 text-sm text-[var(--text-3)]">
                            {source === 'mal'
                                ? 'Your list needs to be public on MyAnimeList.'
                                : 'Your list needs to be public on AniList. Nothing is ever sent to AniList.'}
                        </p>

                        {source === 'anilist' && (
                            <div className="mt-4 flex items-center justify-between gap-4">
                                <div>
                                    <p id={`${ids}-sync`} className="text-[15px] text-[var(--text-1)]">Keep in sync</p>
                                    <p id={`${ids}-sync-help`} className="text-sm text-[var(--text-2)]">
                                        Pull changes from AniList once a day.
                                    </p>
                                </div>
                                <SettingsSwitch
                                    checked={keepInSync}
                                    onClick={() => setKeepInSync((on) => !on)}
                                    labelledBy={`${ids}-sync`}
                                    describedBy={`${ids}-sync-help`}
                                    disabled={!verified}
                                />
                            </div>
                        )}
                    </form>
                ) : (
                    <AniListLink
                        user={user}
                        link={link}
                        running={!!imports.running}
                        disabled={!verified}
                        onStarted={started}
                        onError={setError}
                    />
                )}

                {source === 'mal' && (
                    <p className="mt-4 text-sm text-[var(--text-2)]">
                        List set to private?{' '}
                        <a href={SOURCES.mal.exportUrl} target="_blank" rel="noreferrer" className="text-[var(--signature)] hover:text-[var(--signature-hover)]">
                            Export it from MyAnimeList
                        </a>
                        , then{' '}
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            disabled={blocked}
                            className="font-medium text-[var(--signature)] hover:text-[var(--signature-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {fileMutation.isPending ? 'uploading...' : 'upload the file'}
                        </button>
                        .
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".xml,.gz,application/xml,application/gzip"
                            onChange={handleFile}
                            className="sr-only"
                            tabIndex={-1}
                            aria-label="MyAnimeList export file"
                            data-testid="xml-file-input"
                        />
                    </p>
                )}

                <div aria-live="polite">
                    {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
                    {!verified && (
                        <p className="mt-3 text-sm text-[var(--text-2)]">Verify your email address to import a list.</p>
                    )}
                </div>
            </div>

            <ImportHistory imports={imports} link={link} disabled={blocked} onStarted={started} onError={setError} />
        </section>
    );
}
