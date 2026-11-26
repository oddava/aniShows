import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { authApi } from '../../api/client';
import { getApiErrorMessage, getApiFieldErrors } from '../../api/errors';
import { profileKeys } from '../../api/queries/profile';
import { notify } from '../ui/toast';
import { STATUS_EMOJIS, STATUS_TEXT_MAX, normalizeStatusText, validateStatusText } from './statusOptions';

const PILL = 'profile-status mt-3 flex w-fit max-w-full items-start gap-2 rounded-xl px-3.5 py-2 text-[15px] leading-snug text-[var(--text-1)] sm:mt-4 sm:max-w-2xl';

/** Write the status into every cached copy of this profile (own and by username). */
function patchCachedStatus(queryClient, username, status) {
    const apply = (old) => (old ? { ...old, ...status } : old);
    queryClient.setQueryData(profileKeys.own, apply);
    if (username) queryClient.setQueryData(profileKeys.byUsername(username), apply);
}

function serverMessage(error) {
    const fields = getApiFieldErrors(error);
    const field = fields.status_text?.[0] || fields.status_emoji?.[0];
    return field || getApiErrorMessage(error, 'Couldn’t save your status. Try again.');
}

/**
 * The status line under a profile's name ("🎧 chilling"). Visitors see a
 * plain pill. On your own profile it is a button: it opens a small editor
 * to pick an emoji and write a line, then save or clear it, without going
 * through Edit profile. Saving shows the new status at once and puts the
 * old one back if the server refuses it.
 */
export default function StatusPill({ emoji = '', text = '', editable = false, username }) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [draftEmoji, setDraftEmoji] = useState(emoji || '');
    const [draftText, setDraftText] = useState(text || '');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);
    const inputRef = useRef(null);
    const titleId = useId();
    const countId = useId();
    const errorId = useId();

    const hasStatus = Boolean(emoji || text);

    useEffect(() => {
        if (!open) return undefined;
        inputRef.current?.focus();
        const onPointerDown = (event) => {
            if (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
            setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    if (!editable) {
        if (!hasStatus) return null;
        return (
            <p className={PILL}>
                {emoji && <span aria-hidden="true">{emoji}</span>}
                <span className="min-w-0 break-words">{text}</span>
            </p>
        );
    }

    const openEditor = () => {
        setDraftEmoji(emoji || '');
        setDraftText(text || '');
        setError('');
        setOpen(true);
    };

    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    const save = async (next) => {
        const status = { status_emoji: next.emoji, status_text: normalizeStatusText(next.text) };
        const invalid = validateStatusText(status.status_text);
        if (invalid) {
            setError(invalid);
            return;
        }
        const previous = { status_emoji: emoji || '', status_text: text || '' };
        setSaving(true);
        setError('');
        patchCachedStatus(queryClient, username, status);
        try {
            const response = await authApi.updateProfile(status);
            const saved = response?.data;
            if (saved && ('status_text' in saved || 'status_emoji' in saved)) {
                patchCachedStatus(queryClient, username, {
                    status_emoji: saved.status_emoji ?? status.status_emoji,
                    status_text: saved.status_text ?? status.status_text,
                });
            }
            setOpen(false);
            triggerRef.current?.focus();
            notify(status.status_emoji || status.status_text ? 'Status updated' : 'Status cleared', { id: 'profile-status' });
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
        } catch (err) {
            patchCachedStatus(queryClient, username, previous);
            setError(serverMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const onSubmit = (event) => {
        event.preventDefault();
        save({ emoji: draftEmoji, text: draftText });
    };

    const remaining = STATUS_TEXT_MAX - draftText.length;

    return (
        <div className="relative w-fit max-w-full">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => (open ? close() : openEditor())}
                aria-haspopup="dialog"
                aria-expanded={open}
                className={`${PILL} group text-left transition-[filter] hover:brightness-110 ${hasStatus ? '' : 'border border-dashed border-white/20 !bg-transparent text-[var(--text-2)]'}`}
            >
                {hasStatus ? (
                    <>
                        {emoji && <span aria-hidden="true">{emoji}</span>}
                        <span className="min-w-0 break-words">{text}</span>
                        {/* Read after the visible status (WCAG 2.5.3): "chilling, edit status". */}
                        <span className="sr-only">, edit status</span>
                    </>
                ) : (
                    <span>Set a status</span>
                )}
                <Pencil aria-hidden="true" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--text-3)] opacity-70 group-hover:opacity-100" />
            </button>

            {open && (
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-labelledby={titleId}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.stopPropagation();
                            close();
                        }
                    }}
                    className="popover-in absolute left-0 top-full z-[400] mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-md)] bg-[var(--ink-3)] p-3 shadow-[var(--shadow-pop)]"
                >
                    <form onSubmit={onSubmit} noValidate>
                        <h2 id={titleId} className="text-sm font-semibold text-[var(--text-1)]">Your status</h2>
                        <div role="group" aria-label="Emoji" className="-mx-1 mt-2 flex flex-wrap gap-0.5">
                            <button
                                type="button"
                                onClick={() => setDraftEmoji('')}
                                aria-pressed={!draftEmoji}
                                className={`h-9 rounded-full px-2.5 text-xs text-[var(--text-2)] ${!draftEmoji ? 'bg-white/[0.1] text-[var(--text-1)]' : 'hover:bg-white/[0.06]'}`}
                            >
                                No emoji
                            </button>
                            {[...STATUS_EMOJIS, ...(draftEmoji && !STATUS_EMOJIS.includes(draftEmoji) ? [draftEmoji] : [])].map((choice) => (
                                <button
                                    key={choice}
                                    type="button"
                                    onClick={() => setDraftEmoji(choice)}
                                    aria-pressed={draftEmoji === choice}
                                    aria-label={choice}
                                    className={`h-9 w-9 rounded-full text-lg leading-none ${draftEmoji === choice ? 'bg-white/[0.12] ring-1 ring-[var(--signature)]' : 'hover:bg-white/[0.06]'}`}
                                >
                                    {choice}
                                </button>
                            ))}
                        </div>
                        <label className="mt-3 block">
                            <span className="sr-only">Status text</span>
                            <input
                                ref={inputRef}
                                type="text"
                                value={draftText}
                                onChange={(event) => {
                                    setDraftText(event.target.value);
                                    if (error) setError('');
                                }}
                                maxLength={STATUS_TEXT_MAX}
                                placeholder="What are you up to?"
                                aria-invalid={error ? 'true' : undefined}
                                aria-describedby={`${countId}${error ? ` ${errorId}` : ''}`}
                                className="input h-11 w-full py-0"
                            />
                        </label>
                        <p id={countId} className={`mt-1 text-right text-xs tabular ${remaining <= 10 ? 'text-[var(--status-on-hold)]' : 'text-[var(--text-3)]'}`}>
                            {draftText.length}/{STATUS_TEXT_MAX}
                        </p>
                        {error && (
                            <p id={errorId} role="alert" className="mt-1 text-sm text-[var(--danger)]">{error}</p>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2">
                            {hasStatus ? (
                                <button
                                    type="button"
                                    onClick={() => save({ emoji: '', text: '' })}
                                    disabled={saving}
                                    className="btn-ghost -ml-2 text-sm"
                                >
                                    Clear status
                                </button>
                            ) : <span />}
                            <div className="flex items-center gap-1">
                                <button type="button" onClick={close} className="btn-ghost text-sm">Cancel</button>
                                <button type="submit" disabled={saving} className="btn-primary px-4 text-sm">
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
