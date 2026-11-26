import { useState } from 'react';
import { EyeOff, Trash2 } from 'lucide-react';

import { adminApi, errorMessage } from '../../api';
import { useAdminAction } from '../../hooks';
import { formatNumber, plural } from '../../format';
import { BulkBar, Button, ConfirmDialog } from '../../ui';
import { notifyError } from '../../../components/ui/toast';
import { REVIEW_INVALIDATE } from './ReviewDrawer';

/** Model labels from a delete dry run, in words. */
const MODEL_WORDS = {
    'anime.Review': ['review', 'reviews'],
    'anime.ReviewVote': ['vote', 'votes'],
    'anime.ReviewReaction': ['reaction', 'reactions'],
    'anime.ReviewReport': ['report', 'reports'],
};

export function describeCascade(byModel = {}) {
    return Object.entries(byModel)
        .filter(([, count]) => count > 0)
        .map(([label, count]) => {
            const words = MODEL_WORDS[label];
            return words ? plural(count, words[0], words[1]) : `${formatNumber(count)} × ${label.split('.').pop()}`;
        });
}

/**
 * Bulk actions on selected reviews (superusers; the bulk API refuses staff).
 * Delete asks the server first (a dry run), shows what would go, and sends
 * `confirm` = the matched count, so a stale selection cannot delete more.
 */
export default function BulkReviewActions({ selection }) {
    const [plan, setPlan] = useState(null); // { kind: 'delete'|'toggle_spoiler', matched, cascade }
    const [checking, setChecking] = useState(false);

    const run = useAdminAction(
        ({ operation, ids, confirm, reason }) => adminApi.post('bulk', {
            operation,
            entity_type: 'review',
            entity_ids: ids,
            ...(confirm !== undefined && { confirm }),
            ...(reason && { reason }),
        }),
        {
            invalidate: REVIEW_INVALIDATE,
            success: (data) => data?.message || 'Done.',
            error: 'The bulk action did not go through.',
            onSuccess: () => {
                setPlan(null);
                selection.clear();
            },
        },
    );

    const startDelete = async () => {
        setChecking(true);
        try {
            const result = await adminApi.post('bulk', {
                operation: 'delete',
                entity_type: 'review',
                entity_ids: selection.ids,
                dry_run: true,
            });
            setPlan({ kind: 'delete', matched: result.matched, cascade: describeCascade(result.would_delete_by_model) });
        } catch (err) {
            notifyError(errorMessage(err, 'Could not check what would be deleted.'));
        } finally {
            setChecking(false);
        }
    };

    return (
        <>
            <BulkBar count={selection.count} onClear={selection.clear}>
                <Button size="sm" variant="secondary" icon={EyeOff} onClick={() => setPlan({ kind: 'toggle_spoiler', matched: selection.count })}>
                    Toggle spoiler
                </Button>
                <Button size="sm" variant="danger" icon={Trash2} loading={checking} onClick={startDelete}>
                    Delete
                </Button>
            </BulkBar>

            <ConfirmDialog
                open={plan?.kind === 'toggle_spoiler'}
                onClose={() => setPlan(null)}
                title={`Toggle the spoiler flag on ${plural(plan?.matched || 0, 'review')}?`}
                confirmLabel="Toggle spoiler"
                busy={run.isPending}
                onConfirm={() => run.mutate({ operation: 'toggle_spoiler', ids: selection.ids })}
            >
                Reviews marked as spoilers lose the flag; the others gain it.
            </ConfirmDialog>

            <ConfirmDialog
                open={plan?.kind === 'delete'}
                onClose={() => setPlan(null)}
                title={`Remove ${plural(plan?.matched || 0, 'review')}?`}
                tone="danger"
                confirmLabel="Remove reviews"
                confirmText={plan?.matched > 10 ? 'delete' : undefined}
                reason={{ label: 'Reason for the authors', required: true, hint: 'Each author gets an in-app notice with this reason. It is also kept in the audit log.' }}
                busy={run.isPending}
                confirmDisabled={plan?.matched === 0}
                onConfirm={({ reason }) => run.mutate({ operation: 'delete', ids: selection.ids, confirm: plan.matched, reason })}
            >
                {plan?.matched === 0 ? 'None of the selected reviews exist any more.' : (
                    <>
                        This removes them for everyone and cannot be undone.
                        {plan?.cascade?.length > 0 && <> It deletes {plan.cascade.join(', ')} in all.</>}
                    </>
                )}
            </ConfirmDialog>
        </>
    );
}
