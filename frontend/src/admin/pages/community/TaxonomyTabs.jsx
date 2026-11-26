import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { adminApi, adminKeys, fieldErrors } from '../../api';
import { useAdminAction, useAdminList, useRole } from '../../hooks';
import { formatNumber, plural } from '../../format';
import {
    Button, ConfirmDialog, DataTable, Dialog, EmptyState, Field, Menu, TextArea, TextInput,
} from '../../ui';
import { CATEGORIES, TAGS } from './forumActions';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Create/edit form in a dialog. `fields` describes the inputs:
 * { name, label, type: 'text'|'textarea'|'number'|'color', hint, required }.
 */
function EditDialog({ open, onClose, title, fields, initial, onSubmit, busy, errors, submitLabel }) {
    const [form, setForm] = useState(initial);
    useEffect(() => {
        if (open) setForm(initial);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const submit = (event) => {
        event.preventDefault();
        onSubmit(form);
    };
    const set = (name, value) => setForm((current) => ({ ...current, [name]: value }));

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={title}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button variant="primary" onClick={submit} loading={busy}>{submitLabel}</Button>
                </>
            )}
        >
            <form onSubmit={submit} className="space-y-4 pb-1">
                {fields.map((field) => (
                    <Field key={field.name} label={field.label} hint={field.hint} error={errors?.[field.name]} required={field.required}>
                        {(id, aria) => {
                            const value = form?.[field.name] ?? '';
                            if (field.type === 'textarea') {
                                return <TextArea id={id} {...aria} rows={3} value={value} onChange={(event) => set(field.name, event.target.value)} />;
                            }
                            if (field.type === 'color') {
                                return (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="color"
                                            aria-label={`${field.label} picker`}
                                            value={HEX.test(value) ? value : '#8db1ff'}
                                            onChange={(event) => set(field.name, event.target.value)}
                                            className="h-11 w-14 shrink-0 cursor-pointer rounded-lg bg-white/[0.06] p-1"
                                        />
                                        <TextInput id={id} {...aria} value={value} maxLength={7} onChange={(event) => set(field.name, event.target.value)} className="admin-mono" />
                                    </div>
                                );
                            }
                            return (
                                <TextInput
                                    id={id}
                                    {...aria}
                                    type={field.type === 'number' ? 'number' : 'text'}
                                    value={value}
                                    required={field.required}
                                    onChange={(event) => set(field.name, event.target.value)}
                                    autoFocus={field.autoFocus}
                                />
                            );
                        }}
                    </Field>
                ))}
            </form>
        </Dialog>
    );
}

/** Shared CRUD state for a small forum taxonomy (categories, tags). */
function useTaxonomy(resource, noun) {
    const [editing, setEditing] = useState(null); // {} for new, a row to edit
    const [deleting, setDeleting] = useState(null);
    const [errors, setErrors] = useState({});
    const invalidate = [adminKeys.resource(resource), adminKeys.resource('forum-threads')];

    const save = useAdminAction(
        ({ id, ...body }) => (id ? adminApi.patch(`${resource}/${id}`, body) : adminApi.post(resource, body)),
        {
            invalidate,
            success: (_data, variables) => `${noun} ${variables.id ? 'saved' : 'created'}.`,
            error: `Could not save the ${noun.toLowerCase()}.`,
            onSuccess: () => {
                setEditing(null);
                setErrors({});
            },
            onError: (err) => setErrors(fieldErrors(err)),
        },
    );
    const remove = useAdminAction(
        (row) => adminApi.del(`${resource}/${row.id}`),
        { invalidate, success: `${noun} deleted.`, error: `Could not delete the ${noun.toLowerCase()}.`, onSuccess: () => setDeleting(null) },
    );

    return {
        editing,
        startEdit: (row) => {
            setErrors({});
            setEditing(row || {});
        },
        stopEdit: () => setEditing(null),
        deleting,
        setDeleting,
        errors,
        save,
        remove,
    };
}

function TaxonomyHeader({ text, canEdit, onAdd, addLabel }) {
    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-2)]">
                {text}
                {!canEdit && ' Only superusers can change them.'}
            </p>
            {canEdit && <Button variant="primary" icon={Plus} onClick={onAdd}>{addLabel}</Button>}
        </div>
    );
}

export function CategoriesTab() {
    const { isSuperuser } = useRole();
    const categories = useAdminList(CATEGORIES, { page_size: 200, ordering: 'order' });
    const crud = useTaxonomy(CATEGORIES, 'Category');
    const rows = [...categories.rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
    const blocked = crud.deleting && Number(crud.deleting.thread_count) > 0;

    const columns = [
        { key: 'order', header: 'Order', align: 'right', width: '5rem', cell: (row) => formatNumber(row.order), hideOnPhone: true },
        {
            key: 'name',
            header: 'Category',
            primary: true,
            cell: (row) => (
                <span className="block min-w-0">
                    <span className="block font-medium text-[var(--text-1)]">{row.name}</span>
                    <span className="admin-mono block truncate text-xs text-[var(--text-3)]">{row.slug}</span>
                </span>
            ),
        },
        { key: 'description', header: 'Description', cell: (row) => <span className="line-clamp-2 text-[var(--text-2)]">{row.description || '—'}</span> },
        { key: 'threads', header: 'Threads', align: 'right', width: '6rem', cell: (row) => formatNumber(row.thread_count) },
        ...(isSuperuser ? [{
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label={`Actions for ${row.name}`}
                    items={[
                        { label: 'Edit', icon: Pencil, onSelect: () => crud.startEdit(row) },
                        { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => crud.setDeleting(row) },
                    ]}
                />
            ),
        }] : []),
    ];

    const initial = crud.editing?.id
        ? { name: crud.editing.name, slug: crud.editing.slug, description: crud.editing.description || '', order: String(crud.editing.order ?? 0) }
        : { name: '', slug: '', description: '', order: String(rows.length ? Math.max(...rows.map((row) => row.order ?? 0)) + 1 : 0) };

    return (
        <>
            <TaxonomyHeader
                text="Categories group forum threads. Lower order numbers show first."
                canEdit={isSuperuser}
                onAdd={() => crud.startEdit(null)}
                addLabel="New category"
            />
            <DataTable
                caption="Forum categories"
                columns={columns}
                rows={rows}
                loading={categories.isInitialLoading}
                fetching={categories.isFetching}
                error={categories.error}
                onRetry={() => categories.refetch()}
                onRowClick={isSuperuser ? (row) => crud.startEdit(row) : undefined}
                empty={(
                    <EmptyState
                        title="No categories yet"
                        compact
                        actions={isSuperuser && <Button variant="primary" icon={Plus} onClick={() => crud.startEdit(null)}>New category</Button>}
                    >
                        Members need at least one category to start a thread.
                    </EmptyState>
                )}
            />

            <EditDialog
                open={Boolean(crud.editing)}
                onClose={crud.stopEdit}
                title={crud.editing?.id ? `Edit ${crud.editing.name}` : 'New category'}
                submitLabel={crud.editing?.id ? 'Save' : 'Create category'}
                busy={crud.save.isPending}
                errors={crud.errors}
                initial={initial}
                fields={[
                    { name: 'name', label: 'Name', required: true, autoFocus: true },
                    { name: 'slug', label: 'Slug', hint: 'Used in the address. Leave blank to make one from the name.' },
                    { name: 'description', label: 'Description', type: 'textarea' },
                    { name: 'order', label: 'Order', type: 'number', hint: 'Lower numbers show first.' },
                ]}
                onSubmit={(form) => crud.save.mutate({
                    id: crud.editing?.id,
                    name: form.name.trim(),
                    slug: form.slug.trim(), // blank makes one from the name
                    description: form.description.trim(),
                    order: Number.parseInt(form.order, 10) || 0,
                })}
            />

            {blocked ? (
                <Dialog
                    open
                    onClose={() => crud.setDeleting(null)}
                    title={`${crud.deleting.name} still has threads`}
                    size="sm"
                    footer={<Button variant="primary" onClick={() => crud.setDeleting(null)}>Got it</Button>}
                >
                    <p className="pb-1 text-sm leading-relaxed text-[var(--text-2)]">
                        It holds {plural(crud.deleting.thread_count, 'thread')}. Move them to another category from the Threads tab, then delete it.
                    </p>
                </Dialog>
            ) : (
                <ConfirmDialog
                    open={Boolean(crud.deleting)}
                    onClose={() => crud.setDeleting(null)}
                    title={`Delete ${crud.deleting?.name || 'category'}?`}
                    tone="danger"
                    confirmLabel="Delete category"
                    busy={crud.remove.isPending}
                    onConfirm={() => crud.remove.mutate(crud.deleting)}
                >
                    It has no threads. Members will no longer see it.
                </ConfirmDialog>
            )}
        </>
    );
}

export function TagsTab() {
    const { isSuperuser } = useRole();
    const tags = useAdminList(TAGS, { page_size: 200 });
    const crud = useTaxonomy(TAGS, 'Tag');
    const rows = [...tags.rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const columns = [
        {
            key: 'name',
            header: 'Tag',
            primary: true,
            cell: (row) => (
                <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: HEX.test(row.color || '') ? row.color : 'var(--text-3)' }} />
                    <span className="font-medium text-[var(--text-1)]">{row.name}</span>
                </span>
            ),
        },
        { key: 'slug', header: 'Slug', cell: (row) => <span className="admin-mono text-[var(--text-2)]">{row.slug}</span> },
        { key: 'color', header: 'Colour', hideOnPhone: true, cell: (row) => <span className="admin-mono text-[var(--text-2)]">{row.color}</span> },
        { key: 'threads', header: 'Threads', align: 'right', width: '6rem', cell: (row) => formatNumber(row.thread_count ?? 0) },
        ...(isSuperuser ? [{
            key: 'actions',
            actions: true,
            cell: (row) => (
                <Menu
                    label={`Actions for ${row.name}`}
                    items={[
                        { label: 'Edit', icon: Pencil, onSelect: () => crud.startEdit(row) },
                        { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => crud.setDeleting(row) },
                    ]}
                />
            ),
        }] : []),
    ];

    const initial = crud.editing?.id
        ? { name: crud.editing.name, slug: crud.editing.slug, color: crud.editing.color || '#8db1ff' }
        : { name: '', slug: '', color: '#8db1ff' };

    return (
        <>
            <TaxonomyHeader
                text="Tags let members label threads across categories."
                canEdit={isSuperuser}
                onAdd={() => crud.startEdit(null)}
                addLabel="New tag"
            />
            <DataTable
                caption="Forum tags"
                columns={columns}
                rows={rows}
                loading={tags.isInitialLoading}
                fetching={tags.isFetching}
                error={tags.error}
                onRetry={() => tags.refetch()}
                onRowClick={isSuperuser ? (row) => crud.startEdit(row) : undefined}
                empty={(
                    <EmptyState
                        title="No tags yet"
                        compact
                        actions={isSuperuser && <Button variant="primary" icon={Plus} onClick={() => crud.startEdit(null)}>New tag</Button>}
                    >
                        {isSuperuser ? 'Add tags so members can label their threads.' : 'Superusers create tags; they show up here.'}
                    </EmptyState>
                )}
            />

            <EditDialog
                open={Boolean(crud.editing)}
                onClose={crud.stopEdit}
                title={crud.editing?.id ? `Edit ${crud.editing.name}` : 'New tag'}
                submitLabel={crud.editing?.id ? 'Save' : 'Create tag'}
                busy={crud.save.isPending}
                errors={crud.errors}
                initial={initial}
                fields={[
                    { name: 'name', label: 'Name', required: true, autoFocus: true },
                    { name: 'slug', label: 'Slug', hint: 'Leave blank to make one from the name.' },
                    { name: 'color', label: 'Colour', type: 'color', hint: 'A hex colour such as #8db1ff.' },
                ]}
                onSubmit={(form) => crud.save.mutate({
                    id: crud.editing?.id,
                    name: form.name.trim(),
                    slug: form.slug.trim(), // blank makes one from the name
                    color: form.color.trim(),
                })}
            />

            <ConfirmDialog
                open={Boolean(crud.deleting)}
                onClose={() => crud.setDeleting(null)}
                title={`Delete the ${crud.deleting?.name || ''} tag?`}
                tone="danger"
                confirmLabel="Delete tag"
                busy={crud.remove.isPending}
                onConfirm={() => crud.remove.mutate(crud.deleting)}
            >
                {Number(crud.deleting?.thread_count) > 0
                    ? `It comes off ${plural(crud.deleting.thread_count, 'thread')}. The threads stay.`
                    : 'No threads use it.'}
            </ConfirmDialog>

        </>
    );
}
