import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EyeOff, Eye, Trash2 } from 'lucide-react';

import { adminApi, adminKeys } from '../../api';
import { useAdminAction, useAdminQuery } from '../../hooks';
import { formatDateTime, formatRelative, plural } from '../../format';
import {
    AnimeCell, Button, Chip, ConfirmDialog, Drawer, ErrorState, KeyValue, Skeleton, UserCell,
} from '../../ui';
import { PlainText, Rating } from './shared';

const SUB_RATINGS = [
    ['rating_story', 'Story'],
    ['rating_animation', 'Animation'],
    ['rating_music', 'Music'],
    ['rating_characters', 'Characters'],
];

/** Every list a review change can touch. */
export const REVIEW_INVALIDATE = [
    adminKeys.resource('reviews'),
    adminKeys.resource('moderation/reviews'),
    adminKeys.view('moderation/summary'),
];

/**
 * A review in full: text, ratings, who wrote it about what, and the staff
 * actions (spoiler flag, delete). `reviewId` null keeps it closed.
 */
export default function ReviewDrawer({ reviewId, onClose, onDeleted, inQueue = false }) {
    const open = reviewId !== null && reviewId !== undefined && reviewId !== '';
    const [confirmDelete, setConfirmDelete] = useState(false);

    const review = useAdminQuery(
        adminKeys.detail('reviews', reviewId),
        ({ signal }) => adminApi.get(`reviews/${reviewId}`, undefined, { signal }),
        { enabled: open },
    );

    const toggleSpoiler = useAdminAction(
        (id) => adminApi.post(`reviews/${id}/toggle_spoiler`),
        {
            invalidate: [...REVIEW_INVALIDATE, adminKeys.detail('reviews', reviewId)],
            success: (data) => (data?.has_spoilers ? 'Marked as containing spoilers.' : 'Spoiler flag removed.'),
            error: 'Could not change the spoiler flag.',
        },
    );

    const remove = useAdminAction(
        ({ id, reason }) => adminApi.del(`reviews/${id}`, undefined, { reason }),
        {
            invalidate: REVIEW_INVALIDATE,
            success: 'Review removed. The author has been told why.',
            error: 'Could not remove the review.',
            onSuccess: () => {
                setConfirmDelete(false);
                onDeleted?.();
                onClose();
            },
        },
    );

    const data = review.data;
    const subRatings = data ? SUB_RATINGS.filter(([key]) => data[key] !== null && data[key] !== undefined) : [];

    return (
        <>
            <Drawer
                open={open}
                onClose={onClose}
                title={data?.anime?.title ? `Review of ${data.anime.title}` : 'Review'}
                description={data ? `Written ${formatRelative(data.created_at)}` : undefined}
                footer={data && (
                    <>
                        <Button
                            variant="secondary"
                            icon={data.has_spoilers ? Eye : EyeOff}
                            loading={toggleSpoiler.isPending}
                            onClick={() => toggleSpoiler.mutate(data.id)}
                        >
                            {data.has_spoilers ? 'Remove spoiler flag' : 'Mark as spoiler'}
                        </Button>
                        <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                            Remove review
                        </Button>
                    </>
                )}
            >
                {review.isLoading && (
                    <div className="space-y-3" aria-busy="true">
                        <Skeleton className="h-10 w-2/3" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-1/2" />
                    </div>
                )}
                {review.error && !data && <ErrorState error={review.error} onRetry={() => review.refetch()} compact />}
                {data && (
                    <div className="space-y-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-2xl"><Rating value={data.rating} /></span>
                            {data.has_spoilers && <Chip tone="warning">Contains spoilers</Chip>}
                            {Number(data.report_count) > 0 && (
                                inQueue ? <Chip tone="danger">{plural(data.report_count, 'open report')}</Chip> : <Link
                                    to={`/admin/moderation?open=${data.id}`}
                                    className="rounded-md transition-opacity hover:opacity-80"
                                    title="Handle these reports in the moderation queue"
                                >
                                    <Chip tone="danger">{plural(data.report_count, 'open report')} · review in queue</Chip>
                                </Link>
                            )}
                        </div>

                        <PlainText text={data.text} empty="This review has a rating but no text." />

                        {subRatings.length > 0 && (
                            <KeyValue
                                columns={4}
                                items={subRatings.map(([key, label]) => ({ label, value: <Rating value={data[key]} /> }))}
                            />
                        )}

                        <div className="space-y-3 rounded-[var(--radius-md)] bg-white/[0.03] p-3.5">
                            <div className="flex items-center justify-between gap-3">
                                <UserCell user={data.user} secondary="Author" />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <AnimeCell anime={data.anime} secondary="Anime" />
                                {data.anime?.slug && (
                                    <Link to={`/anime/${data.anime.slug}`} target="_blank" rel="noopener noreferrer" className="text-link shrink-0 text-sm">
                                        View on site
                                    </Link>
                                )}
                            </div>
                        </div>

                        <KeyValue
                            items={[
                                { label: 'Written', value: formatDateTime(data.created_at) },
                                { label: 'Last edited', value: data.updated_at && data.updated_at !== data.created_at ? formatDateTime(data.updated_at) : null },
                                { label: 'Review id', value: <span className="admin-mono">{data.id}</span> },
                            ]}
                        />
                    </div>
                )}
            </Drawer>

            <ConfirmDialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title="Remove this review?"
                tone="danger"
                confirmLabel="Remove review"
                reason={{ label: 'Reason for the author', required: true, placeholder: 'For example: spoils the ending without a warning', hint: 'The author gets an in-app notice with this reason. It is also kept in the audit log.' }}
                busy={remove.isPending}
                onConfirm={({ reason }) => remove.mutate({ id: data.id, reason })}
            >
                It is removed for everyone, with its votes, reactions and reports. This cannot be undone. To keep it but
                hide the text behind a warning, mark it as a spoiler instead.
            </ConfirmDialog>
        </>
    );
}
