import { useEffect, useState } from 'react';

import { adminApi, adminKeys } from '../../api';
import { useAdminAction } from '../../hooks';
import { formatNumber } from '../../format';
import { Button, CheckboxRow, Dialog, Field, Notice, Select, TextInput } from '../../ui';

/** Server caps (apps/core/services/admin_import_jobs_service.py); the API answers 400 above them. */
export const SLICE_LIMIT_MAX = 500;
export const FULL_CATALOG_LIMIT = 5000;
export const BATCH_SIZE_MAX = 500;
export const OFFLINE_IMPORT_LIMIT_MAX = 100_000;

export const SOURCES = [
    {
        value: 'offline_catalog',
        label: 'Anime offline database',
        description: 'Reads a release of the Anime Offline Database, adds new titles and queues AniList enrichment for them.',
    },
    {
        value: 'anime_catalog',
        label: 'AniList catalog slice',
        description: 'Fetches one slice of the catalog from AniList: this season, next season, what is airing, or everything.',
    },
    {
        value: 'metadata_enrichment',
        label: 'AniList metadata',
        description: 'Fills in missing details (tags, studios, cast, relations) for anime that already exist.',
    },
    {
        value: 'trending',
        label: 'AniList trending',
        description: 'Refreshes the trending ranks shown on the home page.',
    },
];

const SYNC_TYPES = [
    { value: 'seasonal', label: 'This season' },
    { value: 'next_season', label: 'Next season' },
    { value: 'airing', label: 'Airing now' },
    { value: 'full_catalog', label: 'Full catalog' },
];

const ANIME_STATUSES = [
    { value: '', label: 'Any status' },
    { value: 'Airing', label: 'Airing' },
    { value: 'Finished', label: 'Finished' },
    { value: 'Upcoming', label: 'Upcoming' },
    { value: 'Unknown', label: 'Unknown' },
];

const DEFAULTS = {
    source: 'offline_catalog',
    sync_type: 'seasonal',
    limit: '50',
    batch_size: '100',
    status: '',
    missing_tags_only: false,
    release_tag: 'latest',
    import_limit: '',
    offline_batch_size: '250',
    enrichment_chunk_size: '100',
    resume: true,
    enqueue_enrichment: true,
};

const toInt = (value) => (value === '' || value === null || value === undefined ? undefined : Number.parseInt(value, 10));

/** The request body for the chosen source: only the fields that source reads. */
export function buildTriggerBody(form) {
    switch (form.source) {
        case 'trending':
            return { source: 'trending', limit: toInt(form.limit) };
        case 'anime_catalog':
            return { source: 'anime_catalog', sync_type: form.sync_type, limit: toInt(form.limit) };
        case 'metadata_enrichment':
            return {
                source: 'metadata_enrichment',
                batch_size: toInt(form.batch_size),
                missing_tags_only: Boolean(form.missing_tags_only),
                ...(form.status ? { status: form.status } : {}),
            };
        case 'offline_catalog':
        default: {
            const body = {
                source: 'offline_catalog',
                release_tag: (form.release_tag || 'latest').trim(),
                batch_size: toInt(form.offline_batch_size),
                enrichment_chunk_size: toInt(form.enrichment_chunk_size),
                resume: Boolean(form.resume),
                enqueue_enrichment: Boolean(form.enqueue_enrichment),
            };
            const limit = toInt(form.import_limit);
            if (limit) body.import_limit = limit;
            return body;
        }
    }
}

function NumberField({ label, hint, value, onChange, min = 1, max, placeholder }) {
    return (
        <Field label={label} hint={hint}>
            {(id, aria) => (
                <TextInput
                    id={id}
                    {...aria}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => onChange(event.target.value)}
                />
            )}
        </Field>
    );
}

/** "New import" (superusers): pick a source, set its few options, queue it. */
export default function TriggerImportDialog({ open, onClose }) {
    const [form, setForm] = useState(DEFAULTS);
    const [conflict, setConflict] = useState(false);
    const set = (patch) => setForm((current) => ({ ...current, ...patch }));

    useEffect(() => {
        if (open) {
            setForm(DEFAULTS);
            setConflict(false);
        }
    }, [open]);

    const trigger = useAdminAction(
        (body) => adminApi.post('import-jobs/trigger', body),
        {
            invalidate: [adminKeys.resource('import-jobs')],
            success: (data) => data?.message || 'Import queued.',
            error: 'Could not start the import.',
            onSuccess: () => onClose(),
            onError: (error) => setConflict(error?.response?.status === 409),
        },
    );

    const source = SOURCES.find((item) => item.value === form.source) || SOURCES[0];
    const full = form.sync_type === 'full_catalog';
    const limitMax = form.source === 'anime_catalog' && full ? FULL_CATALOG_LIMIT : SLICE_LIMIT_MAX;

    const submit = (event) => {
        event?.preventDefault();
        setConflict(false);
        trigger.mutate(buildTriggerBody(form));
    };

    return (
        <Dialog
            open={open}
            onClose={trigger.isPending ? () => {} : onClose}
            title="New import"
            description="Imports run in the background; this page shows their progress."
            size="md"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={trigger.isPending}>Cancel</Button>
                    <Button variant="primary" onClick={submit} loading={trigger.isPending}>Start import</Button>
                </>
            )}
        >
            <form onSubmit={submit} className="space-y-4 pb-1">
                <Field label="Source" hint={source.description}>
                    {(id, aria) => (
                        <Select
                            id={id}
                            {...aria}
                            value={form.source}
                            onChange={(value) => {
                                setConflict(false);
                                set({ source: value, limit: value === 'anime_catalog' && full ? String(FULL_CATALOG_LIMIT) : '50' });
                            }}
                            options={SOURCES.map(({ value, label }) => ({ value, label }))}
                        />
                    )}
                </Field>

                {form.source === 'anime_catalog' && (
                    <>
                        <Field label="Slice">
                            {(id, aria) => (
                                <Select
                                    id={id}
                                    {...aria}
                                    value={form.sync_type}
                                    onChange={(value) => set({ sync_type: value, limit: value === 'full_catalog' ? String(FULL_CATALOG_LIMIT) : '50' })}
                                    options={SYNC_TYPES}
                                />
                            )}
                        </Field>
                        <NumberField
                            label="How many anime"
                            hint={`At most ${formatNumber(limitMax)}.`}
                            value={form.limit}
                            max={limitMax}
                            onChange={(value) => set({ limit: value })}
                        />
                    </>
                )}

                {form.source === 'trending' && (
                    <NumberField
                        label="How many anime"
                        hint={`At most ${formatNumber(SLICE_LIMIT_MAX)}.`}
                        value={form.limit}
                        max={SLICE_LIMIT_MAX}
                        onChange={(value) => set({ limit: value })}
                    />
                )}

                {form.source === 'metadata_enrichment' && (
                    <>
                        <NumberField
                            label="Batch size"
                            hint={`Anime to enrich in this run, at most ${formatNumber(BATCH_SIZE_MAX)}. Each uses AniList budget.`}
                            value={form.batch_size}
                            max={BATCH_SIZE_MAX}
                            onChange={(value) => set({ batch_size: value })}
                        />
                        <Field label="Only anime that are">
                            {(id, aria) => (
                                <Select id={id} {...aria} value={form.status} onChange={(value) => set({ status: value })} options={ANIME_STATUSES} />
                            )}
                        </Field>
                        <CheckboxRow
                            label="Only anime without tags"
                            description="Skip anime that already have their tags."
                            checked={form.missing_tags_only}
                            onChange={(checked) => set({ missing_tags_only: checked })}
                        />
                    </>
                )}

                {form.source === 'offline_catalog' && (
                    <>
                        <Field label="Release" hint="“latest”, or a release tag such as 2026-47.">
                            {(id, aria) => (
                                <TextInput
                                    id={id}
                                    {...aria}
                                    value={form.release_tag}
                                    maxLength={40}
                                    spellCheck={false}
                                    onChange={(event) => set({ release_tag: event.target.value })}
                                />
                            )}
                        </Field>
                        <NumberField
                            label="Import limit"
                            hint={`Leave empty to read the whole release (at most ${formatNumber(OFFLINE_IMPORT_LIMIT_MAX)}).`}
                            value={form.import_limit}
                            max={OFFLINE_IMPORT_LIMIT_MAX}
                            placeholder="Whole release"
                            onChange={(value) => set({ import_limit: value })}
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                            <NumberField
                                label="Batch size"
                                hint={`At most ${formatNumber(BATCH_SIZE_MAX)}.`}
                                value={form.offline_batch_size}
                                max={BATCH_SIZE_MAX}
                                onChange={(value) => set({ offline_batch_size: value })}
                            />
                            <NumberField
                                label="Enrichment chunk"
                                hint={`At most ${formatNumber(BATCH_SIZE_MAX)}.`}
                                value={form.enrichment_chunk_size}
                                max={BATCH_SIZE_MAX}
                                onChange={(value) => set({ enrichment_chunk_size: value })}
                            />
                        </div>
                        <CheckboxRow
                            label="Resume where the last run stopped"
                            checked={form.resume}
                            onChange={(checked) => set({ resume: checked })}
                        />
                        <CheckboxRow
                            label="Queue AniList enrichment"
                            description="Fetch details for new titles after the import."
                            checked={form.enqueue_enrichment}
                            onChange={(checked) => set({ enqueue_enrichment: checked })}
                        />
                    </>
                )}

                {conflict && (
                    <Notice tone="warning" title="This import is already running">
                        Wait for it to finish or cancel it before starting another.
                    </Notice>
                )}
            </form>
        </Dialog>
    );
}
