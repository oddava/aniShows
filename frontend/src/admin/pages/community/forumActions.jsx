import { useEffect, useState } from 'react';

import { adminApi, adminKeys } from '../../api';
import { useAdminAction, useAdminList } from '../../hooks';
import { plural } from '../../format';
import { Button, Chip, ConfirmDialog, Dialog, Field, Select } from '../../ui';
import { REMOVAL_REASON_MAX } from './shared';

export const THREADS = 'forum-threads';
export const POSTS = 'forum-posts';
export const CATEGORIES = 'forum-categories';
export const TAGS = 'forum-tags';

const THREAD_INVALIDATE = [adminKeys.resource(THREADS), adminKeys.resource(CATEGORIES), adminKeys.resource(POSTS)];
const POST_INVALIDATE = [adminKeys.resource(POSTS), adminKeys.resource(THREADS)];

/** Every forum category, for filters and the move dialog (one request, cached). */
export function useForumCategories() {
    const query = useAdminList(CATEGORIES, { page_size: 200, ordering: 'order' }, { staleTime: 60_000 });
    return query.rows;
}

/** Pinned / Locked / Removed as chips (nothing when it is an ordinary thread). */
export function ThreadStateChips({ thread }) {
    const chips = [];
    if (thread.is_removed) chips.push(<Chip key="removed" tone="danger" dot>Removed</Chip>);
    if (thread.is_pinned) chips.push(<Chip key="pinned" tone="accent">Pinned</Chip>);
    if (thread.is_locked) chips.push(<Chip key="locked" tone="warning">Locked</Chip>);
    if (!chips.length) return <span className="text-[var(--text-3)]">—</span>;
    return <span className="inline-flex flex-wrap gap-1.5">{chips}</span>;
}

function MoveDialog({ thread, onClose, busy, onMove }) {
    const categories = useForumCategories();
    const [categoryId, setCategoryId] = useState('');
    useEffect(() => {
        if (thread) setCategoryId(String(thread.category?.id ?? ''));
    }, [thread]);
    const unchanged = !categoryId || String(categoryId) === String(thread?.category?.id ?? '');
    return (
        <Dialog
            open={Boolean(thread)}
            onClose={onClose}
            title="Move thread"
            description={thread ? `“${thread.title}” moves to another category. Its replies go with it.` : undefined}
            size="sm"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button variant="primary" loading={busy} disabled={unchanged} onClick={() => onMove(Number(categoryId))}>
                        Move thread
                    </Button>
                </>
            )}
        >
            <Field label="Category">
                {(id) => (
                    <Select
                        id={id}
                        value={categoryId}
                        onChange={setCategoryId}
                        options={[
                            { value: '', label: 'Choose a category', disabled: true },
                            ...categories.map((category) => ({ value: String(category.id), label: category.name })),
                        ]}
                    />
                )}
            </Field>
        </Dialog>
    );
}

/**
 * Staff actions on a thread, shared by the list menu and the drawer:
 *   const actions = useThreadActions({ onDeleted });
 *   actions.togglePin(thread); actions.request('remove', thread);
 *   …and render {actions.dialogs} once.
 */
export function useThreadActions({ onDeleted } = {}) {
    const [pending, setPending] = useState(null); // { kind, thread }
    const close = () => setPending(null);

    const post = (path, body) => adminApi.post(`${THREADS}/${path}`, body);

    const pin = useAdminAction(
        (thread) => post(`${thread.id}/pin`, { is_pinned: !thread.is_pinned }),
        { invalidate: THREAD_INVALIDATE, success: (_data, thread) => (thread.is_pinned ? 'Thread unpinned.' : 'Thread pinned.') },
    );
    const lock = useAdminAction(
        (thread) => post(`${thread.id}/lock`, { is_locked: !thread.is_locked }),
        { invalidate: THREAD_INVALIDATE, success: (_data, thread) => (thread.is_locked ? 'Thread unlocked. Members can reply again.' : 'Thread locked. No new replies.') },
    );
    const remove = useAdminAction(
        ({ thread, reason }) => post(`${thread.id}/remove`, { reason }),
        { invalidate: THREAD_INVALIDATE, success: 'Thread removed. Only staff can see it now.', onSuccess: close },
    );
    const restore = useAdminAction(
        (thread) => post(`${thread.id}/restore`),
        { invalidate: THREAD_INVALIDATE, success: 'Thread restored.' },
    );
    const move = useAdminAction(
        ({ thread, categoryId }) => post(`${thread.id}/move`, { category_id: categoryId }),
        { invalidate: THREAD_INVALIDATE, success: 'Thread moved.', onSuccess: close },
    );
    const destroy = useAdminAction(
        (thread) => adminApi.del(`${THREADS}/${thread.id}`),
        {
            invalidate: THREAD_INVALIDATE,
            success: 'Thread deleted permanently.',
            onSuccess: (_data, thread) => {
                close();
                onDeleted?.(thread);
            },
        },
    );

    const thread = pending?.thread;
    const dialogs = (
        <>
            <ConfirmDialog
                open={pending?.kind === 'remove'}
                onClose={close}
                title="Remove this thread?"
                tone="danger"
                confirmLabel="Remove thread"
                reason={{
                    label: 'Reason',
                    required: false,
                    max: REMOVAL_REASON_MAX,
                    hint: 'Optional. Shown to staff and kept in the audit log.',
                }}
                busy={remove.isPending}
                onConfirm={({ reason }) => remove.mutate({ thread, reason })}
            >
                {thread && <>“{thread.title}” disappears for members. Staff still see it, and you can restore it later.</>}
            </ConfirmDialog>

            <ConfirmDialog
                open={pending?.kind === 'delete'}
                onClose={close}
                title="Delete this thread permanently?"
                tone="danger"
                confirmLabel="Delete permanently"
                confirmText="delete"
                busy={destroy.isPending}
                onConfirm={() => destroy.mutate(thread)}
            >
                {thread && (
                    <>
                        “{thread.title}” and {plural(thread.reply_count || 0, 'reply', 'replies')} are erased. This cannot be undone.
                        Removing hides it instead and can be reversed.
                    </>
                )}
            </ConfirmDialog>

            <MoveDialog
                thread={pending?.kind === 'move' ? thread : null}
                onClose={close}
                busy={move.isPending}
                onMove={(categoryId) => move.mutate({ thread, categoryId })}
            />
        </>
    );

    return {
        togglePin: (target) => pin.mutate(target),
        toggleLock: (target) => lock.mutate(target),
        restore: (target) => restore.mutate(target),
        request: (kind, target) => setPending({ kind, thread: target }),
        busy: pin.isPending || lock.isPending || restore.isPending,
        dialogs,
    };
}

/** Remove / restore for posts, shared by the list menu and the drawer. */
export function usePostActions() {
    const [removing, setRemoving] = useState(null);

    const remove = useAdminAction(
        ({ post, reason }) => adminApi.post(`${POSTS}/${post.id}/remove`, { reason }),
        { invalidate: POST_INVALIDATE, success: 'Post removed. Members see a placeholder.', onSuccess: () => setRemoving(null) },
    );
    const restore = useAdminAction(
        (post) => adminApi.post(`${POSTS}/${post.id}/restore`),
        { invalidate: POST_INVALIDATE, success: 'Post restored.' },
    );

    const dialogs = (
        <ConfirmDialog
            open={Boolean(removing)}
            onClose={() => setRemoving(null)}
            title="Remove this post?"
            tone="danger"
            confirmLabel="Remove post"
            reason={{
                label: 'Reason',
                required: false,
                max: REMOVAL_REASON_MAX,
                hint: 'Optional. Shown to staff and kept in the audit log.',
            }}
            busy={remove.isPending}
            onConfirm={({ reason }) => remove.mutate({ post: removing, reason })}
        >
            Members see “removed by a moderator” in its place. Replies to it stay. You can restore it later.
        </ConfirmDialog>
    );

    return {
        request: (post) => setRemoving(post),
        restore: (post) => restore.mutate(post),
        busy: restore.isPending,
        dialogs,
    };
}
