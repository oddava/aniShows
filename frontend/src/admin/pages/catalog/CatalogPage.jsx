import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';

import { adminApi, adminKeys, fieldErrors } from '../../api';
import { useAdminAction, useAdminList, useListParams, useRole, useSelection } from '../../hooks';
import { formatNumber } from '../../format';
import {
    BulkBar, Button, DataTable, Dialog, EmptyState, Field, Menu, Notice, PageHeader, Pagination, Panel, SearchInput,
    Select, TextArea, TextInput, Toolbar,
    withCurrentSort,
} from '../../ui';
import { useBulkDelete, useDeleteRecord, useOpenParam } from './shared';

/**
 * One catalog record's form. Superusers edit; staff see the same fields
 * read-only. `field`: { name, label, type: text|url|number|date|textarea,
 * required, placeholder, hint, maxLength }.
 */
function RecordDialog({ open, onClose, config, record, readOnly, onSaved }) {
    const creating = !record;
    const [form, setForm] = useState(() => config.toForm(record));
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (open) {
            setForm(config.toForm(record));
            setErrors({});
        }
    }, [open, record]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = useAdminAction(
        (payload) => (creating
            ? adminApi.post(config.resource, payload)
            : adminApi.patch(`${config.resource}/${record.id}`, payload)),
        {
            invalidate: [adminKeys.resource(config.resource)],
            success: creating ? `Added the ${config.singular}.` : 'Saved.',
            error: `Could not save the ${config.singular}.`,
            onSuccess: (data) => onSaved?.(data),
            onError: (error) => setErrors(fieldErrors(error)),
        },
    );

    const submit = (event) => {
        event.preventDefault();
        if (readOnly) return;
        setErrors({});
        save.mutate(config.toPayload(form));
    };

    const formId = `catalog-form-${config.resource}`;
    const title = creating
        ? `New ${config.singular}`
        : readOnly ? record?.name : `Edit ${record?.name || config.singular}`;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={title}
            description={readOnly ? 'Read only. Superusers can edit the catalog.' : undefined}
            size="md"
            footer={readOnly ? (
                <Button variant="secondary" onClick={onClose}>Close</Button>
            ) : (
                <>
                    <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId} loading={save.isPending}>
                        {creating ? `Add ${config.singular}` : 'Save'}
                    </Button>
                </>
            )}
        >
            <form id={formId} onSubmit={submit} className="space-y-4 pb-1" noValidate>
                {config.fields.map((field) => {
                    const value = form[field.name] ?? '';
                    const onChange = (event) => setForm((current) => ({ ...current, [field.name]: event.target.value }));
                    const hint = field.maxLength
                        ? `${field.hint ? `${field.hint} ` : ''}${String(value).length}/${field.maxLength}`
                        : field.hint;
                    return (
                        <Field key={field.name} label={field.label} hint={hint} error={errors[field.name]} required={field.required && !readOnly}>
                            {(id, aria) => (field.type === 'textarea' ? (
                                <TextArea
                                    id={id}
                                    {...aria}
                                    value={value}
                                    onChange={onChange}
                                    placeholder={field.placeholder}
                                    maxLength={field.maxLength}
                                    readOnly={readOnly}
                                    rows={4}
                                />
                            ) : (
                                <TextInput
                                    id={id}
                                    {...aria}
                                    type={field.type || 'text'}
                                    inputMode={field.type === 'number' ? 'numeric' : undefined}
                                    value={value}
                                    onChange={onChange}
                                    placeholder={field.placeholder}
                                    maxLength={field.maxLength}
                                    required={field.required}
                                    readOnly={readOnly}
                                />
                            ))}
                        </Field>
                    );
                })}
                {errors.non_field_errors && <p className="text-sm text-[var(--danger)]">{errors.non_field_errors}</p>}
            </form>
        </Dialog>
    );
}

/**
 * List + create/edit/delete for one catalog resource (genres, studios,
 * characters, people). Reads are open to staff; writes are superuser-only,
 * so staff get the list and a read-only record view.
 */
export default function CatalogPage({ config }) {
    const { isSuperuser } = useRole();
    const list = useListParams(config.defaultOrdering ? { ordering: config.defaultOrdering } : {});
    const query = useAdminList(config.resource, list.apiParams, { onVanishedPage: list.setPage });
    const selection = useSelection([list.search, list.values]);
    const [openId, setOpenId] = useOpenParam();
    const [creating, setCreating] = useState(false);
    const invalidate = [adminKeys.resource(config.resource)];

    const openFromRows = query.rows.find((row) => String(row.id) === String(openId));
    const openDetail = useQuery({
        queryKey: adminKeys.detail(config.resource, openId),
        queryFn: ({ signal }) => adminApi.get(`${config.resource}/${openId}`, undefined, { signal }),
        enabled: Boolean(openId) && !openFromRows && !query.isLoading,
        retry: false,
    });
    const openRecord = openFromRows || openDetail.data || null;

    const remove = useDeleteRecord({
        resource: config.resource,
        noun: config.singular,
        invalidate,
        allowForce: config.allowForce,
        onDone: () => setOpenId(null),
    });
    const bulk = useBulkDelete({
        entity: config.entity,
        noun: config.plural,
        primaryLabel: config.modelLabel,
        invalidate,
        allowForce: config.allowForce,
        onDone: selection.clear,
    });

    const columns = useMemo(() => [
        ...config.columns,
        {
            key: 'actions',
            actions: true,
            header: 'Actions',
            cell: (row) => (
                <Menu
                    label={`Actions for ${row.name}`}
                    items={[
                        { label: isSuperuser ? 'Edit' : 'View details', icon: Pencil, onSelect: () => setOpenId(row.id) },
                        config.publicHref && { label: 'View on site', icon: ExternalLink, onSelect: () => window.open(config.publicHref(row), '_blank', 'noopener') },
                        isSuperuser && 'divider',
                        { label: 'Delete', icon: Trash2, tone: 'danger', hidden: !isSuperuser, onSelect: () => remove.ask(row) },
                    ].filter(Boolean)}
                />
            ),
        },
    ], [config, isSuperuser]); // eslint-disable-line react-hooks/exhaustive-deps

    const emptyState = list.isFiltered ? (
        <EmptyState title={`No ${config.plural} match`} actions={<Button variant="secondary" onClick={list.reset}>Clear search</Button>} compact>
            Try a different name.
        </EmptyState>
    ) : (
        <EmptyState
            title={`No ${config.plural} yet`}
            actions={isSuperuser && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{`Add ${config.singular}`}</Button>}
            compact
        >
            {config.emptyHint || (isSuperuser ? `${config.title} arrive with catalog imports, or add one here.` : `${config.title} arrive with catalog imports.`)}
        </EmptyState>
    );

    return (
        <>
            <PageHeader
                title={config.title}
                description={config.description}
                meta={!query.isInitialLoading && <span className="text-sm text-[var(--text-3)] tabular">{formatNumber(query.count)} in total</span>}
                actions={isSuperuser && (
                    <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{`Add ${config.singular}`}</Button>
                )}
            />

            {!isSuperuser && (
                <Notice className="mb-4">Read only. Superusers can add, edit and delete {config.plural}.</Notice>
            )}

            <Panel>
                <Toolbar>
                    <SearchInput
                        value={list.searchInput}
                        onChange={list.setSearchInput}
                        placeholder={config.searchPlaceholder || `Search ${config.plural}`}
                    />
                    {config.sortOptions && (
                        <Select
                            label="Sort by"
                            value={list.values.ordering}
                            onChange={(value) => list.set({ ordering: value })}
                            options={withCurrentSort(config.sortOptions, list.values.ordering)}
                            className="!w-auto min-w-[10rem] max-md:hidden"
                        />
                    )}
                </Toolbar>

                <DataTable
                    caption={config.title}
                    columns={columns}
                    rows={query.rows}
                    loading={query.isLoading}
                    fetching={query.isFetching}
                    error={query.error}
                    onRetry={query.refetch}
                    empty={emptyState}
                    selection={isSuperuser ? selection : undefined}
                    sort={config.defaultOrdering ? { value: list.values.ordering, onChange: (value) => list.set({ ordering: value }), options: config.sortOptions } : undefined}
                    onRowClick={(row) => setOpenId(row.id)}
                />
                <Pagination page={list.page} totalPages={query.totalPages} count={query.count} pageSize={list.pageSize} onChange={list.setPage} />
            </Panel>

            {isSuperuser && (
                <BulkBar count={selection.count} onClear={selection.clear}>
                    <Button variant="danger" size="sm" icon={Trash2} loading={bulk.checking} onClick={() => bulk.start(selection.ids)}>
                        Delete
                    </Button>
                </BulkBar>
            )}

            <RecordDialog
                open={creating}
                onClose={() => setCreating(false)}
                config={config}
                record={null}
                onSaved={() => setCreating(false)}
            />
            <RecordDialog
                open={Boolean(openId) && Boolean(openRecord)}
                onClose={() => setOpenId(null)}
                config={config}
                record={openRecord}
                readOnly={!isSuperuser}
                onSaved={() => setOpenId(null)}
            />
            {remove.dialog}
            {bulk.dialog}
        </>
    );
}
