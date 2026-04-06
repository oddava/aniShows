import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, RotateCcw, Star, Tv, X } from 'lucide-react';
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
        notes: entry?.notes || '',
    };
}

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

            if (nextStatus === 'Completed') {
                nextForm.episodes_watched = String(episodeCap);
                return nextForm;
            }

            if (currentEpisodes >= episodeCap) {
                nextForm.episodes_watched = String(Math.max(episodeCap - 1, 0));
            }

            return nextForm;
        });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setErrorMessage('');

        const score = form.score === '' ? 0 : Number(form.score);
        let episodesWatched = form.episodes_watched === '' ? 0 : Number(form.episodes_watched);
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

        if (episodeCap != null && form.status !== 'Completed' && episodesWatched >= episodeCap) {
            episodesWatched = Math.max(episodeCap - 1, 0);
        }

        if (!Number.isInteger(totalRewatches) || totalRewatches < 0) {
            setErrorMessage('Total rewatches must be a non-negative whole number.');
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
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent/80">Add To List</p>
                        <h2 id="list-entry-modal-title" className="mt-2 text-xl font-black text-white sm:text-2xl">
                            Edit List Entry
                        </h2>
                        <p className="mt-1 text-sm text-gray-400">
                            Track progress, dates, rating, and notes without leaving the anime page.
                        </p>
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
                            <InputShell icon={Star}>
                                <input
                                    id="list-entry-score"
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="1"
                                    value={form.score}
                                    onChange={(event) => updateField('score', event.target.value)}
                                    placeholder="Leave blank for unrated"
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-gray-500"
                                />
                            </InputShell>
                        </Field>

                        <Field
                            label="Episode Progress"
                            htmlFor="list-entry-progress"
                            hint={episodeCap != null ? `Max ${episodeCap}` : 'No cap'}
                        >
                            <InputShell icon={Tv}>
                                <input
                                    id="list-entry-progress"
                                    type="number"
                                    min="0"
                                    max={episodeCap ?? undefined}
                                    step="1"
                                    value={form.episodes_watched}
                                    onChange={(event) => updateField('episodes_watched', event.target.value)}
                                    placeholder="Episodes watched"
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-gray-500"
                                />
                            </InputShell>
                        </Field>

                        <Field label="Total Rewatches" htmlFor="list-entry-rewatches">
                            <InputShell icon={RotateCcw}>
                                <input
                                    id="list-entry-rewatches"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={form.total_rewatches}
                                    onChange={(event) => updateField('total_rewatches', event.target.value)}
                                    placeholder="0"
                                    className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-gray-500"
                                />
                            </InputShell>
                        </Field>

                        <Field label="Start Date" htmlFor="list-entry-start-date">
                            <InputShell icon={Calendar}>
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
                            <InputShell icon={Calendar}>
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

                    <div className="mt-4">
                        <Field label="Notes" htmlFor="list-entry-notes">
                            <textarea
                                id="list-entry-notes"
                                rows="5"
                                value={form.notes}
                                onChange={(event) => updateField('notes', event.target.value)}
                                placeholder="Optional notes about this entry"
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
                            className="inline-flex items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-black text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
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

function InputShell({ icon: Icon, children }) {
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-dark-200 px-4 py-3 transition-colors focus-within:border-accent/60">
            <Icon className="h-4 w-4 shrink-0 text-gray-500" />
            {children}
        </div>
    );
}
