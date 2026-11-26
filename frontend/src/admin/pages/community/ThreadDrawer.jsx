import { Link } from 'react-router-dom';
import { ArrowUpRight, FolderInput, Lock, Pin, PinOff, RotateCcw, Trash2, Unlock } from 'lucide-react';

import { adminApi, adminKeys } from '../../api';
import { useAdminQuery, useRole } from '../../hooks';
import { formatDateTime, formatNumber, formatRelative } from '../../format';
import {
    Button, Drawer, ErrorState, KeyValue, Menu, Notice, Skeleton, UserCell,
} from '../../ui';
import { THREADS, ThreadStateChips } from './forumActions';
import { PlainText } from './shared';

/**
 * A thread in full with the staff actions. `actions` comes from the page's
 * useThreadActions(), so the dialogs are shared with the list.
 */
export default function ThreadDrawer({ threadId, onClose, actions }) {
    const { isSuperuser } = useRole();
    const open = Boolean(threadId);
    const thread = useAdminQuery(
        adminKeys.detail(THREADS, threadId),
        ({ signal }) => adminApi.get(`${THREADS}/${threadId}`, undefined, { signal }),
        { enabled: open },
    );
    const data = thread.data;

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={data?.title || 'Thread'}
            description={data ? `In ${data.category?.name || 'an unknown category'} · started ${formatRelative(data.created_at)}` : undefined}
            footer={data && (
                <>
                    {data.is_removed ? (
                        <Button variant="primary" icon={RotateCcw} loading={actions.busy} onClick={() => actions.restore(data)}>
                            Restore thread
                        </Button>
                    ) : (
                        <Button variant="danger" onClick={() => actions.request('remove', data)}>Remove thread</Button>
                    )}
                    <Button variant="secondary" icon={data.is_pinned ? PinOff : Pin} loading={actions.busy} onClick={() => actions.togglePin(data)}>
                        {data.is_pinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Menu
                        label="More thread actions"
                        items={[
                            { label: data.is_locked ? 'Unlock replies' : 'Lock replies', icon: data.is_locked ? Unlock : Lock, onSelect: () => actions.toggleLock(data) },
                            { label: 'Move to another category', icon: FolderInput, onSelect: () => actions.request('move', data) },
                            'divider',
                            { label: 'Delete permanently', icon: Trash2, tone: 'danger', hidden: !isSuperuser, onSelect: () => actions.request('delete', data) },
                        ]}
                    />
                </>
            )}
        >
            {thread.isLoading && (
                <div className="space-y-3" aria-busy="true">
                    <Skeleton className="h-6 w-1/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                </div>
            )}
            {thread.error && !data && <ErrorState error={thread.error} onRetry={() => thread.refetch()} compact />}
            {data && (
                <div className="space-y-6">
                    <ThreadStateChips thread={data} />

                    {data.is_removed && (
                        <Notice tone="danger" title={data.removed_at ? `Removed ${formatRelative(data.removed_at)}` : 'Removed'}>
                            {data.removal_reason ? `Reason: ${data.removal_reason}` : 'No reason was given.'}
                        </Notice>
                    )}

                    <PlainText text={data.content ?? data.snippet} empty="This thread has no opening text." />

                    <div className="rounded-[var(--radius-md)] bg-white/[0.03] p-3.5">
                        <UserCell user={data.author} secondary="Started the thread" />
                    </div>

                    <KeyValue
                        items={[
                            { label: 'Replies', value: formatNumber(data.reply_count) },
                            { label: 'Views', value: formatNumber(data.view_count) },
                            { label: 'Likes', value: formatNumber(data.like_count) },
                            { label: 'Started', value: formatDateTime(data.created_at) },
                            { label: 'Last activity', value: formatDateTime(data.updated_at) },
                            { label: 'Thread id', value: <span className="admin-mono">{data.id}</span> },
                        ]}
                    />

                    <div className="flex flex-wrap gap-x-5">
                        <Link to={`/admin/forums?tab=posts&thread=${data.id}`} className="text-link text-sm">Replies in this thread</Link>
                        <Link to={`/forums/thread/${data.id}`} target="_blank" rel="noopener" className="text-link gap-1 text-sm">
                            View on site <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                    </div>
                </div>
            )}
        </Drawer>
    );
}
