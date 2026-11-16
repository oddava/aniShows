import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, EyeOff, Flag, Trash2 } from 'lucide-react';

import api from '../../api/client';
import { adminKeys, adminQueries } from '../../api/queries/admin';
import CustomSelect from '../../components/common/CustomSelect';
import ErrorState from '../../components/common/ErrorState';
import AdminPagination from './components/AdminPagination';
import ConfirmDialog from './components/ConfirmDialog';
import { getAdminErrorMessage, useAdminList, useAdminQuery } from './hooks/useAdminQuery';

export const REPORT_REASONS = {
    spoiler: 'Spoiler',
    spam: 'Spam',
    harassment: 'Harassment',
    hate_speech: 'Hate speech',
    misinformation: 'Misinformation',
    off_topic: 'Off topic',
    other: 'Other',
};

const SIGNAL_LABELS = {
    low_rating: 'Low rating',
    spoiler_tag: 'Spoiler tag',
    empty_text: 'No text',
};

const STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'in_review', label: 'In review' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
];

const REVIEW_OUTCOMES = {
    dismiss: {
        label: 'Dismiss',
        title: 'Dismiss these reports?',
        body: 'The review stays as it is and its open reports are closed as dismissed.',
        icon: CheckCircle2,
    },
    mark_spoiler: {
        label: 'Mark spoiler',
        title: 'Mark this review as a spoiler?',
        body: 'The review is hidden behind a spoiler warning and its open reports are resolved.',
        icon: EyeOff,
    },
    remove_review: {
        label: 'Remove review',
        title: 'Remove this review?',
        body: 'The review is deleted for everyone and its open reports are resolved. This cannot be undone.',
        icon: Trash2,
        destructive: true,
    },
};

const FORUM_OUTCOMES = {
    dismiss: { ...REVIEW_OUTCOMES.dismiss, body: 'The post stays as it is and its open reports are dismissed.' },
    remove: {
        label: 'Remove post',
        title: 'Remove this post?',
        body: 'The post is removed and its open reports are resolved. This cannot be undone.',
        icon: Trash2,
        destructive: true,
    },
};

const NOTES_MAX = 1000;
const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const buttonClass = (destructive) => `inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] sm:min-h-0 text-sm rounded-lg transition-colors ${destructive
    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
    : 'bg-white/10 text-white/80 hover:bg-white/20'}`;

function ReasonChips({ counts }) {
    const entries = Object.entries(counts || {}).filter(([, count]) => count > 0);
    if (entries.length === 0) return null;
    return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Report reasons">
            {entries.map(([reason, count]) => (
                <li key={reason} className="px-2 py-0.5 rounded-md border border-white/10 text-xs text-white/70">
                    {REPORT_REASONS[reason] || reason} <span className="text-white font-medium">{count}</span>
                </li>
            ))}
        </ul>
    );
}

function ResolveDialog({ target, outcomes, busy, onCancel, onConfirm }) {
    const notesId = useId();
    const [notes, setNotes] = useState('');
    const outcome = target ? outcomes[target.outcome] : null;
    return (
        <ConfirmDialog
            isOpen={Boolean(target)}
            title={outcome?.title || ''}
            message={outcome?.body}
            confirmLabel={outcome?.label}
            destructive={outcome?.destructive}
            busy={busy}
            onCancel={onCancel}
            onConfirm={() => onConfirm(notes.trim())}
        >
            <div>
                <label htmlFor={notesId} className="block text-sm text-white/70 mb-1">Notes (optional)</label>
                <textarea
                    id={notesId}
                    value={notes}
                    maxLength={NOTES_MAX}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 resize-none"
                />
            </div>
        </ConfirmDialog>
    );
}

function useResolve({ path, invalidate, success }) {
    const queryClient = useQueryClient();
    const [target, setTarget] = useState(null);
    const [busy, setBusy] = useState(false);

    const confirm = async (notes) => {
        setBusy(true);
        try {
            await api.post(path(target.id), { outcome: target.outcome, ...(notes && { notes }) });
            toast.success(success(target.outcome));
            invalidate.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
            setTarget(null);
        } catch (err) {
            toast.error(getAdminErrorMessage(err, 'Failed to resolve the reports'));
        } finally {
            setBusy(false);
        }
    };

    return { target, setTarget, busy, confirm };
}

const MODERATION_INVALIDATE = [
    adminKeys.resource('moderation/reviews'),
    adminKeys.resource('moderation/forums'),
    adminKeys.moderation(),
    adminKeys.resource('reviews'),
];

function ReviewQueue() {
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState('open');
    const [reason, setReason] = useState('');
    const [signals, setSignals] = useState(false);

    const list = useAdminList({
        resource: 'moderation/reviews',
        params: {
            page,
            status,
            ...(reason && { reason }),
            ...(signals && { signals: 1 }),
        },
        page,
        setPage,
        errorLog: 'Failed to fetch the moderation queue:',
    });
    const resolve = useResolve({
        path: (id) => `/admin/moderation/reviews/${id}/resolve/`,
        invalidate: MODERATION_INVALIDATE,
        success: (outcome) => ({
            dismiss: 'Reports dismissed',
            mark_spoiler: 'Review marked as a spoiler',
            remove_review: 'Review removed',
        }[outcome]),
    });

    // Resolving closes open reports, so it only applies to rows that have some.
    // Unreported signal rows are handled on the Reviews page (delete there).
    const statusOpen = status === 'open' || status === 'in_review';
    const canAct = (row) => statusOpen && row.report_total > 0;

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="sm:w-44">
                    <CustomSelect
                        value={status}
                        onChange={(next) => { setStatus(next); setPage(1); }}
                        options={STATUS_OPTIONS}
                        ariaLabel="Report status"
                        triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                    />
                </div>
                <div className="sm:w-48">
                    <CustomSelect
                        value={reason}
                        onChange={(next) => { setReason(next); setPage(1); }}
                        options={[{ value: '', label: 'All reasons' }, ...Object.entries(REPORT_REASONS).map(([value, label]) => ({ value, label }))]}
                        ariaLabel="Report reason"
                        triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm"
                    />
                </div>
                <label className="flex items-center gap-2 min-h-[44px] text-sm text-white/70">
                    <input
                        type="checkbox"
                        checked={signals}
                        onChange={(e) => { setSignals(e.target.checked); setPage(1); }}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-violet-500"
                    />
                    Include quality signals (unreported)
                </label>
            </div>

            {list.error ? (
                <ErrorState
                    title="Couldn’t load the queue"
                    message={getAdminErrorMessage(list.error, 'Failed to load the moderation queue')}
                    onRetry={() => list.refetch()}
                />
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {list.isFetching && list.items.length === 0 ? (
                        <p role="status" className="px-4 py-12 text-center text-white/60">Loading queue...</p>
                    ) : list.items.length === 0 ? (
                        <p className="px-4 py-12 text-center text-white/50">Nothing to review.</p>
                    ) : (
                        <ul className="divide-y divide-white/5">
                            {list.items.map((row) => (
                                <li key={row.review_id} className="p-4 sm:p-5 space-y-3">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                        <Link to={`/anime/${row.anime?.slug}`} className="font-medium text-white hover:text-violet-300">
                                            {row.anime?.title}
                                        </Link>
                                        <span className="text-white/50">by {row.author?.username ?? 'deleted user'}</span>
                                        <span className="text-white/50">{row.rating}/10</span>
                                        {row.has_spoilers && (
                                            <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                                                <AlertTriangle size={12} aria-hidden="true" /> Spoiler
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-white/80 break-words">{row.snippet || <span className="text-white/40">No text</span>}</p>
                                    <ReasonChips counts={row.report_counts} />
                                    {row.signals?.length > 0 && (
                                        <p className="text-xs text-white/50">
                                            Signals: {row.signals.map((s) => SIGNAL_LABELS[s] || s).join(', ')}
                                        </p>
                                    )}
                                    <p className="text-xs text-white/50">
                                        {row.report_total || 0} report{row.report_total === 1 ? '' : 's'} from {row.reporter_count || 0} user{row.reporter_count === 1 ? '' : 's'}
                                        {row.first_reported_at && ` · first ${formatDate(row.first_reported_at)} · last ${formatDate(row.last_reported_at)}`}
                                    </p>
                                    {canAct(row) ? (
                                        <div className="flex flex-wrap gap-2">
                                            {Object.entries(REVIEW_OUTCOMES).map(([outcome, meta]) => {
                                                const Icon = meta.icon;
                                                if (outcome === 'mark_spoiler' && row.has_spoilers) return null;
                                                return (
                                                    <button
                                                        key={outcome}
                                                        type="button"
                                                        onClick={() => resolve.setTarget({ id: row.review_id, outcome })}
                                                        className={buttonClass(meta.destructive)}
                                                    >
                                                        <Icon size={14} aria-hidden="true" />
                                                        {meta.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : signals && !row.report_total ? (
                                        <Link
                                            to="/admin/reviews"
                                            className="inline-flex items-center min-h-[44px] sm:min-h-0 text-sm text-violet-300 hover:text-violet-200"
                                        >
                                            Not reported: manage it on the Reviews page
                                        </Link>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                    <AdminPagination page={page} totalPages={list.totalPages} onPageChange={setPage} />
                </div>
            )}

            <ResolveDialog
                key={resolve.target ? `${resolve.target.id}-${resolve.target.outcome}` : 'closed'}
                target={resolve.target}
                outcomes={REVIEW_OUTCOMES}
                busy={resolve.busy}
                onCancel={() => resolve.setTarget(null)}
                onConfirm={resolve.confirm}
            />
        </div>
    );
}

function ForumQueue() {
    const [page, setPage] = useState(1);
    const list = useAdminList({
        resource: 'moderation/forums',
        params: { page },
        page,
        setPage,
        errorLog: 'Failed to fetch forum reports:',
    });
    const resolve = useResolve({
        path: (id) => `/admin/moderation/forums/${id}/resolve/`,
        invalidate: MODERATION_INVALIDATE,
        success: (outcome) => (outcome === 'remove' ? 'Post removed' : 'Reports dismissed'),
    });

    if (list.error) {
        return (
            <ErrorState
                title="Couldn’t load forum reports"
                message={getAdminErrorMessage(list.error, 'Failed to load forum reports')}
                onRetry={() => list.refetch()}
            />
        );
    }

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            {list.items.length === 0 ? (
                <p className="px-4 py-12 text-center text-white/50">
                    {list.isFetching ? 'Loading reports...' : 'Nothing to review.'}
                </p>
            ) : (
                <ul className="divide-y divide-white/5">
                    {list.items.map((row) => (
                        <li key={row.id} className="p-4 sm:p-5 space-y-3">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                {row.target_url ? (
                                    <Link to={row.target_url} className="font-medium text-white hover:text-violet-300">Forum post</Link>
                                ) : <span className="font-medium text-white">Forum post</span>}
                                <span className="text-white/50">by {(typeof row.author === 'string' ? row.author : row.author?.username) ?? 'deleted user'}</span>
                            </div>
                            <p className="text-sm text-white/80 break-words">{row.snippet}</p>
                            <ReasonChips counts={row.reasons} />
                            <p className="text-xs text-white/50">
                                First {formatDate(row.first_at)} · last {formatDate(row.last_at)}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(FORUM_OUTCOMES).map(([outcome, meta]) => {
                                    const Icon = meta.icon;
                                    return (
                                        <button
                                            key={outcome}
                                            type="button"
                                            onClick={() => resolve.setTarget({ id: row.id, outcome })}
                                            className={buttonClass(meta.destructive)}
                                        >
                                            <Icon size={14} aria-hidden="true" />
                                            {meta.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <AdminPagination page={page} totalPages={list.totalPages} onPageChange={setPage} />
            <ResolveDialog
                key={resolve.target ? `${resolve.target.id}-${resolve.target.outcome}` : 'closed'}
                target={resolve.target}
                outcomes={FORUM_OUTCOMES}
                busy={resolve.busy}
                onCancel={() => resolve.setTarget(null)}
                onConfirm={resolve.confirm}
            />
        </div>
    );
}

const AdminModeration = () => {
    const [tab, setTab] = useState('reviews');
    const { data: summary } = useAdminQuery({
        ...adminQueries.moderationSummary(),
        errorLog: 'Failed to fetch the moderation summary:',
    });
    const forumsAvailable = summary?.forums != null;
    const activeTab = tab === 'forums' && !forumsAvailable ? 'reviews' : tab;

    const tabs = [
        { id: 'reviews', label: 'Reviews', count: summary?.open_reviews },
        ...(forumsAvailable ? [{ id: 'forums', label: 'Forums', count: summary.forums.open }] : []),
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Flag size={22} aria-hidden="true" /> Moderation queue
                </h1>
                <p className="text-sm text-white/50 mt-1">
                    {summary
                        ? `${summary.open_reports || 0} open report${summary.open_reports === 1 ? '' : 's'} on ${summary.open_reviews || 0} review${summary.open_reviews === 1 ? '' : 's'}.`
                        : 'User reports waiting for a decision.'}
                </p>
            </div>

            {tabs.length > 1 && (
                <div role="tablist" aria-label="Report source" className="flex gap-2 border-b border-white/10">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === t.id}
                            onClick={() => setTab(t.id)}
                            className={`px-4 py-2 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === t.id
                                ? 'border-violet-500 text-white'
                                : 'border-transparent text-white/60 hover:text-white'}`}
                        >
                            {t.label}{t.count ? ` (${t.count})` : ''}
                        </button>
                    ))}
                </div>
            )}

            {activeTab === 'forums' ? <ForumQueue /> : <ReviewQueue />}
        </div>
    );
};

export default AdminModeration;
