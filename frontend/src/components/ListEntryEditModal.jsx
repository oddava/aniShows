import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import useFocusTrap from '../hooks/useFocusTrap';
import CustomSelect from './common/CustomSelect';

function buildFormState(entry) {
    return {
        status: entry?.status || 'Plan to Watch',
        score: entry?.score > 0 ? String(entry.score) : '',
        episodes_watched:
            entry?.episodes_watched > 0 || entry?.status === 'Completed'
                ? String(entry.episodes_watched ?? '')
                : '',
        started_at: entry?.started_at || '',
        finished_at: entry?.finished_at || '',
        total_rewatches: entry?.total_rewatches > 0 ? String(entry.total_rewatches) : '',
        is_rewatching: Boolean(entry?.is_rewatching),
        notes: entry?.notes || '',
    };
}

/** The server's limit on list notes (G3 normaliser bounds). */
export const NOTES_MAX_LENGTH = 5000;

function extractErrorMessage(error) {
    const details = error?.response?.data;
    if (!details) {
        return 'Failed to save your list entry.';
    }

    if (typeof details.detail === 'string') {
        return details.detail;
    }

    const firstFieldError = Object.values(details).find((value) =>
        typeof value === 'string' || (Array.isArray(value) && value.length > 0)
    );

    if (typeof firstFieldError === 'string') {
        return firstFieldError;
    }

    if (Array.isArray(firstFieldError) && firstFieldError.length > 0) {
        return String(firstFieldError[0]);
    }

    return 'Failed to save your list entry.';
}

export default function ListEntryEditModal({
    isOpen,
    onClose,
    onSave,
    initialEntry,
    totalEpisodes,
    statusOptions,
    isSaving,
    animeTitle,
}) {
    const [form, setForm] = useState(() => buildFormState(initialEntry));
    const [errorMessage, setErrorMessage] = useState('');
    const wasOpenRef = useRef(false);
    const handleRequestClose = useCallback(() => {
        if (!isSaving) {
            onClose();
        }
    }, [isSaving, onClose]);
    const modalRef = useFocusTrap(isOpen, handleRequestClose);

    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            setForm(buildFormState(initialEntry));
            setErrorMessage('');
        }

        wasOpenRef.current = isOpen;
    }, [initialEntry, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    const episodeCap = useMemo(
        () => (typeof totalEpisodes === 'number' && totalEpisodes > 0 ? totalEpisodes : null),
        [totalEpisodes]
    );

    if (!isOpen) return null;

    const handleBackdropClick = (event) => {
        if (event.target === event.currentTarget && !isSaving) {
            handleRequestClose();
        }
    };

    const updateField = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const updateStatus = (nextStatus) => {
        setForm((current) => {
            const nextForm = { ...current, status: nextStatus };

            if (episodeCap == null) {
                return nextForm;
            }

            const currentEpisodes =
                current.episodes_watched === '' ? 0 : Number.parseInt(current.episodes_watched, 10) || 0;

            // Visible in the form, and what the server does anyway. Other statuses keep
            // the typed progress: the server's normaliser decides, the selector shows it.
            if (nextStatus === 'Completed' && currentEpisodes < episodeCap) {
                nextForm.episodes_watched = String(episodeCap);
            }

            return nextForm;
        });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setErrorMessage('');

        const score = form.score === '' ? 0 : Number(form.score);
        const episodesWatched = form.episodes_watched === '' ? 0 : Number(form.episodes_watched);
        const totalRewatches = form.total_rewatches === '' ? 0 : Number(form.total_rewatches);

        if (!Number.isInteger(score) || score < 0 || score > 10) {
            setErrorMessage('Score must be between 0 and 10.');
            return;
        }

        if (!Number.isInteger(episodesWatched) || episodesWatched < 0) {
            setErrorMessage('Episode progress must be a non-negative whole number.');
            return;
        }

        if (episodeCap != null && episodesWatched > episodeCap) {
            setErrorMessage(`Episode progress cannot exceed ${episodeCap}.`);
            return;
        }

        if (!Number.isInteger(totalRewatches) || totalRewatches < 0) {
            setErrorMessage('Total rewatches must be a non-negative whole number.');
            return;
        }

        if (form.notes.length > NOTES_MAX_LENGTH) {
            setErrorMessage(`Notes can be at most ${NOTES_MAX_LENGTH.toLocaleString()} characters.`);
            return;
        }

        if (form.started_at && form.finished_at && form.finished_at < form.started_at) {
            setErrorMessage('Finish date cannot be earlier than start date.');
            return;
        }

        try {
            await onSave({
                status: form.status,
                score,
                episodes_watched: episodesWatched,
                started_at: form.started_at || null,
                finished_at: form.finished_at || null,
                total_rewatches: totalRewatches,
                is_rewatching: form.is_rewatching,
                notes: form.notes,
            });
        } catch (error) {
            setErrorMessage(extractErrorMessage(error));
        }
    };

    return (
        <div
            className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-2 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-entry-modal-title"
        >
            <div
                ref={modalRef}
                className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-dark-100 shadow-[0_24px_120px_rgba(0,0,0,0.55)] sm:max-h-[90dvh] sm:rounded-3xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
                    <div className="min-w-0">
                        <h2 id="list-entry-modal-title" className="mt-2 text-xl font-black text-white sm:text-2xl">
                            {animeTitle ? (
                                <>
                                    <span className="sr-only">Edit list entry for </span>
                                    <span className="block truncate">{animeTitle}</span>
                                </>
                            ) : 'Edit List Entry'}
                        </h2>
                        {animeTitle ? (
                            <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-gray-500" aria-hidden="true">
                                Edit list entry
                            </p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={handleRequestClose}
                        disabled={isSaving}
                        className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Close editor"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Status" htmlFor="list-entry-status">
                            <CustomSelect
                                id="list-entry-status"
                                value={form.status}
                                onChange={updateStatus}
                                options={statusOptions}
                                className="w-full"
                                triggerClassName="rounded-2xl bg-dark-200 focus-visible:ring-accent/60"
                            />
                        </Field>

                        <Field label="Score" htmlFor="list-entry-score" hint="0-10">
                            <InputShell>
                                <input
                                    id="list-entry-score"
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="1"
                                    value={form.score}
                                    onChange={(event) => updateField('score', event.target.value)}
                                    placeholder=""
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-gray-500"
                                />
                            </InputShell>
                        </Field>

                        <Field
                            label="Episode Progress"
                            htmlFor="list-entry-progress"
                            hint={episodeCap != null ? `Max ${episodeCap}` : 'No cap'}
                        >
                            <InputShell>
                                <input
                                    id="list-entry-progress"
                                    type="number"
                                    min="0"
                                    max={episodeCap ?? undefined}
                                    step="1"
                                    value={form.episodes_watched}
                                    onChange={(event) => updateField('episodes_watched', event.target.value)}
                                    placeholder=""
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-gray-500"
                                />
                            </InputShell>
                        </Field>

                        <Field label="Total Rewatches" htmlFor="list-entry-rewatches">
                            <InputShell>
                                <input
                                    id="list-entry-rewatches"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={form.total_rewatches}
                                    onChange={(event) => updateField('total_rewatches', event.target.value)}
                                    placeholder=""
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-gray-500"
                                />
                            </InputShell>
                        </Field>

                        <Field label="Start Date" htmlFor="list-entry-start-date">
                            <InputShell>
                                <input
                                    id="list-entry-start-date"
                                    type="date"
                                    value={form.started_at}
                                    onChange={(event) => updateField('started_at', event.target.value)}
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none [color-scheme:dark]"
                                />
                            </InputShell>
                        </Field>

                        <Field label="Finish Date" htmlFor="list-entry-finish-date">
                            <InputShell>
                                <input
                                    id="list-entry-finish-date"
                                    type="date"
                                    value={form.finished_at}
                                    onChange={(event) => updateField('finished_at', event.target.value)}
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none [color-scheme:dark]"
                                />
                            </InputShell>
                        </Field>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-dark-200 px-4 py-3">
                        <div className="min-w-0">
                            <span id="list-entry-rewatching-label" className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                Rewatching
                            </span>
                            <p className="mt-1 text-xs text-gray-500">
                                Finishing a rewatch adds one to total rewatches.
                            </p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={form.is_rewatching}
                            aria-labelledby="list-entry-rewatching-label"
                            onClick={() => updateField('is_rewatching', !form.is_rewatching)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${form.is_rewatching ? 'bg-accent-dark' : 'bg-white/10'}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`inline-block h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${form.is_rewatching ? 'translate-x-5' : 'translate-x-0.5'}`}
                            />
                        </button>
                    </div>

                    <div className="mt-4">
                        <Field
                            label="Notes"
                            htmlFor="list-entry-notes"
                            hint={(
                                <span id="list-entry-notes-count" className={form.notes.length > NOTES_MAX_LENGTH ? 'text-red-300' : undefined}>
                                    {form.notes.length.toLocaleString()} / {NOTES_MAX_LENGTH.toLocaleString()}
                                </span>
                            )}
                        >
                            <textarea
                                id="list-entry-notes"
                                rows="5"
                                maxLength={NOTES_MAX_LENGTH}
                                aria-describedby="list-entry-notes-count"
                                value={form.notes}
                                onChange={(event) => updateField('notes', event.target.value)}
                                placeholder=""
                                className="w-full resize-y rounded-2xl border border-white/10 bg-dark-200 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-accent/60"
                            />
                        </Field>
                    </div>

                    {errorMessage && (
                        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                            {errorMessage}
                        </div>
                    )}

                    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={handleRequestClose}
                            disabled={isSaving}
                            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="inline-flex items-center justify-center rounded-2xl bg-accent-dark px-5 py-3 text-sm font-black text-white transition-colors hover:bg-accent-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function Field({ label, htmlFor, hint, children }) {
    return (
        <div className="block">
            <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor={htmlFor} className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                    {label}
                </label>
                {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
            </div>
            {children}
        </div>
    );
}

function InputShell({ children }) {
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-dark-200 px-4 py-3 transition-colors focus-within:border-accent/60">
            {children}
        </div>
    );
}
