import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, Trash2 } from 'lucide-react';

import { adminApi } from '../api';
import { useAdminAction, useAdminList, useListParams, useModerationSummary } from '../hooks';
import { formatNumber, formatRelative, plural } from '../format';
import {
    Button, Chip, ConfirmDialog, EmptyState, ErrorState, FilterSelect, Notice, PageHeader, Pagination, Panel,
    Skeleton, Switch, Tabs, Toolbar,
} from '../ui';
import ReviewDrawer, { REVIEW_INVALIDATE } from './community/ReviewDrawer';
import {
    NOTES_MAX, PlainText, Rating, REASON_OPTIONS, REPORT_REASONS, SIGNAL_LABELS, useOpenParam,
} from './community/shared';

const STATUS_TABS = [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
];

/** What each outcome does, said before the moderator commits to it. */
export const OUTCOMES = {
    dismiss: {
        label: 'Dismiss',
        icon: Check,
        title: 'Dismiss these reports?',
        body: 'The review stays as it is. Its open reports close as dismissed.',
        confirm: 'Dismiss reports',
        success: 'Reports dismissed.',
    },
    mark_spoiler: {
        label: 'Mark as spoiler',
        icon: EyeOff,
        title: 'Mark this review as a spoiler?',
        body: 'Readers see a spoiler warning before the text. Its open reports close as resolved.',
        confirm: 'Mark as spoiler',
        success: 'Marked as a spoiler and reports resolved.',
    },
    remove_review: {
        label: 'Remove review',
        icon: Trash2,
        title: 'Remove this review?',
        body: 'The review is deleted for everyone and its open reports close as resolved. This cannot be undone.',
        confirm: 'Remove review',
        success: 'Review removed. The author has been told why.',
        danger: true,
    },
};

function ReasonChips({ counts }) {
    const entries = Object.entries(counts || {}).filter(([, count]) => Number(count) > 0);
    if (!entries.length) return null;
    return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Report reasons">
            {entries.map(([reason, count]) => (
                <li key={reason}>
                    <Chip tone="danger">
                        {REPORT_REASONS[reason] || reason}
                        <span className="ml-1 tabular opacity-80">{formatNumber(count)}</span>
                    </Chip>
                </li>
            ))}
        </ul>
    );
}

function QueueCard({ row, canResolve, onOpen, onResolve }) {
    const reported = Number(row.report_total) > 0;
    return (
        <li className="rounded-[var(--radius-md)] bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                    <p className="text-sm text-[var(--text-2)]">
                        {row.anime?.id ? (
                            <Link to={`/admin/anime/${row.anime.id}`} className="font-semibold text-[var(--text-1)] hover:text-[var(--signature)]">
                                {row.anime.title}
                            </Link>
                        ) : <span className="font-semibold text-[var(--text-1)]">Deleted anime</span>}
                        <span className="px-1.5 text-[var(--text-3)]">by</span>
                        {row.author?.id ? (
                            <Link to={`/admin/users/${row.author.id}`} className="font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                                {row.author.username}
                            </Link>
                        ) : <span>Deleted user</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-3)]">Written {formatRelative(row.created_at)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Rating value={row.rating} />
                    {row.has_spoilers && <Chip tone="warning">Contains spoilers</Chip>}
                    {(row.signals || []).map((signal) => (
                        <Chip key={signal} tone="neutral">{SIGNAL_LABELS[signal] || signal}</Chip>
                    ))}
                </div>
            </div>

            <PlainText text={row.snippet} empty="No text, only a rating." className="mt-3 line-clamp-4" />

            {reported && (
                <div className="mt-3 space-y-2">
                    <ReasonChips counts={row.report_counts} />
                    <p className="text-xs text-[var(--text-3)]">
                        {plural(row.reporter_count || row.report_total, 'person', 'people')} reported this
                        {row.first_reported_at && ` · first ${formatRelative(row.first_reported_at)}`}
                        {row.last_reported_at && formatRelative(row.last_reported_at) !== formatRelative(row.first_reported_at) && ` · latest ${formatRelative(row.last_reported_at)}`}
                    </p>
                </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => onOpen(row.review_id)}>Open review</Button>
                {canResolve && reported && Object.entries(OUTCOMES).filter(([outcome]) => !(outcome === 'mark_spoiler' && row.has_spoilers)).map(([outcome, config]) => (
                    <Button
                        key={outcome}
                        size="sm"
                        variant={config.danger ? 'danger' : 'ghost'}
                        icon={config.icon}
                        onClick={() => onResolve(row, outcome)}
                    >
                        {config.label}
                    </Button>
                ))}
            </div>
        </li>
    );
}

function QueueSkeleton() {
    return (
        <ul className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((index) => (
                <li key={index} className="rounded-[var(--radius-md)] bg-white/[0.03] p-4">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="mt-4 h-3.5 w-full" />
                    <Skeleton className="mt-2 h-3.5 w-4/5" />
                    <Skeleton className="mt-4 h-9 w-64" rounded="rounded-lg" />
                </li>
            ))}
        </ul>
    );
}

function summaryMeta(summary) {
    if (!summary) return null;
    const openReviews = Number(summary.open_reviews) || 0;
    if (!openReviews) return <Chip tone="success" dot>Nothing open</Chip>;
    const reasons = Object.entries(summary.by_reason || {}).filter(([, count]) => count > 0);
    return (
        <>
            <Chip tone="warning" dot>
                {plural(summary.open_reports, 'open report')} on {plural(openReviews, 'review')}
            </Chip>
            {reasons.map(([reason, count]) => (
                <Chip key={reason}>{REPORT_REASONS[reason] || reason} {formatNumber(count)}</Chip>
            ))}
        </>
    );
}

/**
 * The review report queue: one card per reported review, the reasons people
 * gave, and the three outcomes. A heuristic "quality signals" view lists
 * reviews worth a look that nobody reported.
 */
export default function Moderation() {
    const list = useListParams({ status: 'open', reason: '', signals: '' });
    const { status, reason, signals } = list.values;
    const signalsOn = signals === '1';
    const summary = useModerationSummary();
    const queue = useAdminList('moderation/reviews', list.apiParams, { onVanishedPage: list.setPage });
    const [openId, setOpenId] = useOpenParam();
    const [target, setTarget] = useState(null);

    const resolve = useAdminAction(
        ({ id, outcome, notes }) => adminApi.post(`moderation/reviews/${id}/resolve`, { outcome, notes }),
        {
            invalidate: REVIEW_INVALIDATE,
            success: (_data, variables) => OUTCOMES[variables.outcome]?.success || 'Done.',
            error: 'Could not resolve these reports.',
            onSuccess: () => setTarget(null),
        },
    );

    const outcome = target ? OUTCOMES[target.outcome] : null;
    const forums = summary.data?.forums;

    const empty = signalsOn
        ? <EmptyState title="No reviews match these signals" compact>Low ratings, spoiler tags and empty reviews show up here.</EmptyState>
        : status === 'open'
            ? (
                <EmptyState
                    title="No open reports"
                    compact
                    actions={<Button variant="secondary" to="/admin/reviews">Browse all reviews</Button>}
                >
                    Reviews people report land here for a decision.
                </EmptyState>
            )
            : <EmptyState title={`No ${status} reports`} compact>Reports you close show up here.</EmptyState>;

    return (
        <>
            <PageHeader
                title="Moderation"
                description="Reports people send about reviews. Dismiss them, mark the review as a spoiler, or remove it."
                meta={summaryMeta(summary.data)}
            />

            <Tabs
                label="Report status"
                items={STATUS_TABS.map((tab) => ({
                    ...tab,
                    count: tab.value === 'open' ? summary.data?.open_reviews : undefined,
                }))}
                value={status}
                onChange={(value) => list.set({ status: value })}
                panelId="moderation-queue"
                className="mb-4"
            />

            <div className="space-y-4 sm:space-y-5">
                <Panel>
                    <Toolbar>
                        <FilterSelect
                            label="Reason"
                            allLabel="Any reason"
                            value={reason}
                            onChange={(value) => list.set({ reason: value })}
                            options={REASON_OPTIONS}
                        />
                        <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm font-medium text-[var(--text-1)]">
                            <Switch
                                checked={signalsOn}
                                onChange={(on) => list.set({ signals: on ? '1' : '' })}
                                label="Quality signals"
                            />
                            <span aria-hidden="true">Quality signals</span>
                        </label>
                    </Toolbar>

                    {signalsOn && (
                        <Notice tone="accent" className="mb-4">
                            Heuristic, not user reports: reviews rated 3 or lower, tagged as spoilers, or with no text.
                            Reports on them, if any, are counted on each card.
                        </Notice>
                    )}

                    <div id="moderation-queue" role="tabpanel" aria-busy={queue.isFetching || undefined}>
                        {queue.isInitialLoading ? <QueueSkeleton /> : queue.error && !queue.rows.length ? (
                            <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
                        ) : queue.rows.length === 0 ? empty : (
                            <ul className={`space-y-2 transition-opacity ${queue.isFetching ? 'opacity-70' : ''}`}>
                                {queue.rows.map((row) => (
                                    <QueueCard
                                        key={row.review_id}
                                        row={row}
                                        canResolve={status === 'open'}
                                        onOpen={setOpenId}
                                        onResolve={(item, nextOutcome) => setTarget({ id: item.review_id, outcome: nextOutcome })}
                                    />
                                ))}
                            </ul>
                        )}
                        <Pagination
                            page={list.page}
                            totalPages={queue.totalPages}
                            count={queue.count}
                            pageSize={list.pageSize}
                            onChange={list.setPage}
                        />
                    </div>
                </Panel>

                <Notice
                    title={forums && Number(forums.open) > 0 ? `${plural(forums.open, 'open forum report')}` : 'Forum reports are not collected yet'}
                    action={<Button variant="secondary" size="sm" to="/admin/forums">Open forums</Button>}
                >
                    {forums && Number(forums.open) > 0
                        ? 'Review them from the Forums page.'
                        : 'Members cannot report threads or posts yet. Pin, lock, move or remove them from the Forums page.'}
                </Notice>
            </div>

            <ConfirmDialog
                open={Boolean(target)}
                onClose={() => setTarget(null)}
                title={outcome?.title || ''}
                tone={outcome?.danger ? 'danger' : 'primary'}
                confirmLabel={outcome?.confirm}
                reason={target?.outcome === 'remove_review' ? {
                    label: 'Reason for the author',
                    required: true,
                    max: NOTES_MAX,
                    hint: 'The author gets an in-app notice with this reason. It is also saved with the reports and in the audit log.',
                } : {
                    label: 'Notes',
                    required: false,
                    max: NOTES_MAX,
                    hint: 'Optional. Saved with the reports and in the audit log.',
                }}
                busy={resolve.isPending}
                onConfirm={({ reason: notes }) => resolve.mutate({ id: target.id, outcome: target.outcome, notes })}
            >
                {outcome?.body}
            </ConfirmDialog>

            <ReviewDrawer reviewId={openId} onClose={() => setOpenId(null)} inQueue />
        </>
    );
}
