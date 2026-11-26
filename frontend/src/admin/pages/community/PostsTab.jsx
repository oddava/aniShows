import { Link } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';

import { adminApi, adminKeys } from '../../api';
import { useAdminList, useAdminQuery, useListParams } from '../../hooks';
import { formatDateTime, formatNumber, formatRelative } from '../../format';
import {
    Button, Chip, DataTable, Drawer, EmptyState, ErrorState, FilterSelect, KeyValue, Menu, Notice, Pagination,
    SearchInput, Skeleton, Toolbar, UserCell,
} from '../../ui';
import { POSTS, usePostActions } from './forumActions';
import { FilterChip, PlainText, useOpenParam } from './shared';

function PostState({ post }) {
    if (!post.is_removed) return <span className="text-[var(--text-3)]">—</span>;
    return <Chip tone="danger" dot>{post.removed_by_author ? 'Deleted by author' : 'Removed'}</Chip>;
}

function PostDrawer({ postId, onClose, actions }) {
    const open = Boolean(postId);
    const post = useAdminQuery(
        adminKeys.detail(POSTS, postId),
        ({ signal }) => adminApi.get(`${POSTS}/${postId}`, undefined, { signal }),
        { enabled: open },
    );
    const data = post.data;
    const canRestore = data?.is_removed && !data.removed_by_author;

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title="Forum reply"
            description={data ? `In “${data.thread?.title || 'a deleted thread'}” · ${formatRelative(data.created_at)}` : undefined}
            footer={data && (
                data.is_removed ? (
                    canRestore && (
                        <Button variant="primary" icon={RotateCcw} loading={actions.busy} onClick={() => actions.restore(data)}>
                            Restore post
                        </Button>
                    )
                ) : (
                    <Button variant="danger" icon={Trash2} onClick={() => actions.request(data)}>Remove post</Button>
                )
            )}
        >
            {post.isLoading && (
                <div className="space-y-3" aria-busy="true">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                </div>
            )}
            {post.error && !data && <ErrorState error={post.error} onRetry={() => post.refetch()} compact />}
            {data && (
                <div className="space-y-6">
                    {data.is_removed && (
                        <Notice tone="danger" title={data.removed_by_author ? 'Deleted by its author' : 'Removed'}>
                            {data.removed_by_author
                                ? 'The author took this down. Staff cannot restore it.'
                                : data.removal_reason || 'No reason was given.'}
                        </Notice>
                    )}
                    <PlainText text={data.content ?? data.snippet} empty="This post has no text." />
                    <div className="rounded-[var(--radius-md)] bg-white/[0.03] p-3.5">
                        <UserCell user={data.author} secondary="Author" />
                    </div>
                    <KeyValue
                        items={[
                            { label: 'Likes', value: formatNumber(data.like_count) },
                            { label: 'Reply depth', value: data.depth === 0 ? 'Top level' : `Level ${formatNumber(data.depth)}` },
                            { label: 'Posted', value: formatDateTime(data.created_at) },
                            { label: 'Post id', value: <span className="admin-mono">{data.id}</span> },
                        ]}
                    />
                    {data.thread?.id && (
                        <div className="flex flex-wrap gap-x-5">
                            <Link to={`/admin/forums?tab=threads&open=${data.thread.id}`} className="text-link text-sm">Open the thread</Link>
                            <Link to={`/admin/forums?tab=posts&thread=${data.thread.id}`} className="text-link text-sm">All replies in it</Link>
                        </div>
                    )}
                </div>
            )}
        </Drawer>
    );
}

export default function PostsTab() {
    const list = useListParams({ is_removed: '', thread: '', author: '' });
    const { values } = list;
    const posts = useAdminList(POSTS, list.apiParams, { onVanishedPage: list.setPage });
    const [openId, setOpenId] = useOpenParam();
    const actions = usePostActions();

    const threadTitle = posts.rows.find((row) => String(row.thread?.id) === String(values.thread))?.thread?.title;
    const authorName = posts.rows.find((row) => String(row.author?.id) === String(values.author))?.author?.username;

    const clearFilters = () => {
        list.setSearchInput('');
        list.set({ is_removed: '', thread: '', author: '', q: '' });
    };

    const columns = [
        {
            key: 'post',
            header: 'Reply',
            primary: true,
            cell: (row) => (
                <span className="block min-w-0 max-w-lg">
                    <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        className="line-clamp-2 text-left text-[var(--text-1)] hover:text-[var(--signature)]"
                    >
                        {row.snippet?.trim() || 'No text'}
                    </button>
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-3)]">in {row.thread?.title || 'a deleted thread'}</span>
                </span>
            ),
        },
        { key: 'author', header: 'Author', cell: (row) => <UserCell user={row.author} avatarSize="xs" /> },
        { key: 'likes', header: 'Likes', align: 'right', width: '5rem', cell: (row) => formatNumber(row.like_count) },
        { key: 'state', header: 'State', cell: (row) => <PostState post={row} /> },
        {
            key: 'created_at',
            header: 'Posted',
            width: '8.5rem',
            cell: (row) => <span title={formatDateTime(row.created_at)} className="text-[var(--text-2)]">{formatRelative(row.created_at)}</span>,
        },
        {
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label="Actions for this reply"
                    items={[
                        { label: 'Open reply', onSelect: () => setOpenId(row.id) },
                        { label: 'Open the thread', to: `/admin/forums?tab=threads&open=${row.thread?.id}`, hidden: !row.thread?.id },
                        { label: 'Replies in this thread', onSelect: () => list.set({ thread: row.thread?.id }), hidden: !row.thread?.id },
                        'divider',
                        row.is_removed
                            ? { label: 'Restore post', icon: RotateCcw, hidden: row.removed_by_author, onSelect: () => actions.restore(row) }
                            : { label: 'Remove post', icon: Trash2, tone: 'danger', onSelect: () => actions.request(row) },
                    ]}
                />
            ),
        },
    ];

    return (
        <>
            <Toolbar>
                <SearchInput value={list.searchInput} onChange={list.setSearchInput} placeholder="Search replies or authors" />
                <FilterSelect
                    label="State"
                    allLabel="Any state"
                    value={values.is_removed}
                    onChange={(value) => list.set({ is_removed: value })}
                    options={[{ value: 'false', label: 'Visible' }, { value: 'true', label: 'Removed' }]}
                />
                {values.thread && (
                    <FilterChip label={`Thread: ${threadTitle || `#${values.thread}`}`} onRemove={() => list.set({ thread: '' })} />
                )}
                {values.author && (
                    <FilterChip label={`Author: ${authorName || `#${values.author}`}`} onRemove={() => list.set({ author: '' })} />
                )}
            </Toolbar>

            <DataTable
                caption="Forum replies"
                columns={columns}
                rows={posts.rows}
                loading={posts.isInitialLoading}
                fetching={posts.isFetching}
                error={posts.error}
                onRetry={() => posts.refetch()}
                onRowClick={(row) => setOpenId(row.id)}
                empty={list.isFiltered ? (
                    <EmptyState title="No replies match" compact actions={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}>
                        Try a shorter search or another state.
                    </EmptyState>
                ) : (
                    <EmptyState title="No replies yet" compact>Replies to forum threads show up here.</EmptyState>
                )}
            />
            <Pagination page={list.page} totalPages={posts.totalPages} count={posts.count} pageSize={list.pageSize} onChange={list.setPage} />

            <PostDrawer postId={openId} onClose={() => setOpenId(null)} actions={actions} />
            {actions.dialogs}
        </>
    );
}
