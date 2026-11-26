import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { notify, notifyError } from '../../../components/ui/toast';
import { adminApi, errorMessage } from '../../api';
import { formatNumber } from '../../format';
import { ConfirmDialog } from '../../ui';

export { useOpenParam } from '../../hooks';

const KNOWN_MODELS = {
    'anime.Anime': 'Anime',
    'anime.Review': 'Reviews',
    'anime.ReviewVote': 'Review votes',
    'anime.ReviewReaction': 'Review reactions',
    'anime.ReviewReport': 'Review reports',
    'anime.UserFavorite': 'Favorites',
    'anime.UserHistory': 'Watch history entries',
    'anime.EpisodeRating': 'Episode ratings',
    'anime.AnimeCharacter': 'Cast credits',
    'anime.AnimeStaff': 'Staff credits',
    'anime.AnimeStudio': 'Studio links',
    'anime.AnimeRelation': 'Relations',
    'anime.ThemeSong': 'Theme songs',
    'anime.Genre': 'Genres',
    'anime.Studio': 'Studios',
    'anime.Character': 'Characters',
    'anime.Staff': 'People',
    'anime.UserRecommendation': 'Recommendations',
    'anime.OfflineAnimeSyncState': 'Sync states',
    'users.UserAnimeList': 'List entries',
    'users.UserActivity': 'Activity entries',
};

/** "anime.UserFavorite" → "Favorites"; unknown labels become sentence case words. */
export function modelLabel(label) {
    if (KNOWN_MODELS[label]) return KNOWN_MODELS[label];
    const name = String(label).split('.').pop() || String(label);
    const words = name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a delete removes, the selected records first. */
function DeletePreview({ preview, primaryLabel }) {
    const rows = Object.entries(preview?.would_delete_by_model || {})
        .sort(([a], [b]) => (a === primaryLabel ? -1 : b === primaryLabel ? 1 : 0));
    if (!rows.length) return null;
    return (
        <ul className="mt-3 space-y-1 rounded-[var(--radius-md)] bg-white/[0.04] p-3">
            {rows.map(([label, count]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-sm">
                    <span className={label === primaryLabel ? 'font-medium text-[var(--text-1)]' : 'text-[var(--text-2)]'}>{modelLabel(label)}</span>
                    <span className="tabular text-[var(--text-1)]">{formatNumber(count)}</span>
                </li>
            ))}
        </ul>
    );
}

const isLinkedConflict = (error) => {
    const status = error?.response?.status;
    return (status === 400 || status === 409) && /associated anime|force/i.test(errorMessage(error, ''));
};

/**
 * Bulk delete through `bulk/`: a dry run first shows what would go (cascades
 * included), then the real delete sends `confirm=<matched>` so a stale
 * selection can never delete more than the admin saw. Genres and studios
 * linked to anime need a second, forced confirm.
 *
 *   const bulk = useBulkDelete({ entity: 'anime', noun: 'anime', invalidate, onDone: selection.clear });
 *   <Button onClick={() => bulk.start(selection.ids)} loading={bulk.checking}>Delete</Button>
 *   {bulk.dialog}
 */
export function useBulkDelete({ entity, noun, primaryLabel, invalidate = [], onDone, allowForce = false }) {
    const queryClient = useQueryClient();
    const [state, setState] = useState({ step: 'idle', ids: [], preview: null, conflict: '' });

    const check = useMutation({
        mutationFn: (ids) => adminApi.post('bulk', { operation: 'delete', entity_type: entity, entity_ids: ids, dry_run: true }),
        onSuccess: (preview, ids) => setState({ step: 'confirm', ids, preview, conflict: '' }),
        onError: (error) => notifyError(errorMessage(error, 'Could not check what would be deleted.')),
    });

    const remove = useMutation({
        mutationFn: ({ ids, matched, force }) => adminApi.post('bulk', {
            operation: 'delete',
            entity_type: entity,
            entity_ids: ids,
            confirm: matched,
            ...(force && { force: true }),
        }),
        onSuccess: async (data) => {
            await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
            notify(data?.message || `Deleted ${noun}.`);
            setState({ step: 'idle', ids: [], preview: null, conflict: '' });
            onDone?.();
        },
        onError: (error) => {
            if (allowForce && isLinkedConflict(error)) {
                setState((current) => ({ ...current, step: 'force', conflict: errorMessage(error, '') }));
                return;
            }
            notifyError(errorMessage(error, `Could not delete the ${noun}.`));
        },
    });

    const close = () => setState({ step: 'idle', ids: [], preview: null, conflict: '' });
    const matched = state.preview?.matched ?? 0;

    const dialog = (
        <>
            <ConfirmDialog
                open={state.step === 'confirm'}
                onClose={close}
                tone="danger"
                title={`Delete ${formatNumber(matched)} ${noun}?`}
                confirmLabel="Delete"
                busy={remove.isPending}
                confirmDisabled={matched === 0}
                onConfirm={() => remove.mutate({ ids: state.ids, matched })}
                size="md"
            >
                {matched === 0
                    ? 'None of the selected records exist any more. Nothing will be deleted.'
                    : 'This cannot be undone. Everything attached to them goes too:'}
                <DeletePreview preview={state.preview} primaryLabel={primaryLabel} />
            </ConfirmDialog>
            <ConfirmDialog
                open={state.step === 'force'}
                onClose={close}
                tone="danger"
                title="Some are still linked to anime"
                confirmLabel="Delete anyway"
                busy={remove.isPending}
                onConfirm={() => remove.mutate({ ids: state.ids, matched, force: true })}
            >
                {state.conflict} Deleting them anyway removes them from those anime.
            </ConfirmDialog>
        </>
    );

    return { start: (ids) => check.mutate(ids), checking: check.isPending, dialog };
}

/**
 * Delete one record. Genres and studios linked to anime answer with their
 * anime count; the admin then sees that number and can "Delete anyway".
 */
export function useDeleteRecord({ resource, noun, invalidate = [], onDone, allowForce = false }) {
    const queryClient = useQueryClient();
    const [target, setTarget] = useState(null);
    const [conflict, setConflict] = useState(null);

    const remove = useMutation({
        mutationFn: ({ id, force }) => adminApi.del(`${resource}/${id}`, force ? { force: 'true' } : undefined),
        onSuccess: async (data) => {
            await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
            notify(data?.message || `Deleted the ${noun}.`);
            setTarget(null);
            setConflict(null);
            onDone?.();
        },
        onError: (error) => {
            const count = error?.response?.data?.anime_count;
            if (allowForce && (count !== undefined || isLinkedConflict(error))) {
                setConflict({ count, message: errorMessage(error, '') });
                return;
            }
            notifyError(errorMessage(error, `Could not delete the ${noun}.`));
        },
    });

    const close = () => {
        setTarget(null);
        setConflict(null);
    };

    const dialog = (
        <>
            <ConfirmDialog
                open={Boolean(target) && !conflict}
                onClose={close}
                tone="danger"
                title={target ? `Delete ${target.name || target.title || `this ${noun}`}?` : ''}
                confirmLabel="Delete"
                busy={remove.isPending}
                onConfirm={() => remove.mutate({ id: target.id })}
            >
                {target?.anime_count
                    ? `It is linked to ${formatNumber(target.anime_count)} anime. This cannot be undone.`
                    : 'This cannot be undone.'}
            </ConfirmDialog>
            <ConfirmDialog
                open={Boolean(target) && Boolean(conflict)}
                onClose={close}
                tone="danger"
                title={`Still linked to ${conflict?.count !== undefined ? formatNumber(conflict.count) : 'some'} anime`}
                confirmLabel="Delete anyway"
                busy={remove.isPending}
                onConfirm={() => remove.mutate({ id: target.id, force: true })}
            >
                {`Deleting ${target?.name || `this ${noun}`} anyway removes it from ${conflict?.count !== undefined ? `those ${formatNumber(conflict.count)} anime` : 'those anime'}. This cannot be undone.`}
            </ConfirmDialog>
        </>
    );

    return { ask: setTarget, dialog, isPending: remove.isPending };
}
