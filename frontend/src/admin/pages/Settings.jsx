import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { adminApi, adminKeys } from '../api';
import { useAdminAction, useAdminQuery, useRole } from '../hooks';
import {
    Button, ConfirmDialog, ErrorState, Field, Notice, PageHeader, Panel, PanelSkeleton, SwitchRow, TextInput,
} from '../ui';

const SETTINGS_KEY = adminKeys.view('settings');

/** The enforced settings (apps/admin_api/services/settings_service.py SETTINGS_VALIDATION_RULES). */
export const SECTIONS = [
    {
        key: 'general',
        title: 'Site',
        description: 'Who can reach the site and sign up.',
        fields: [
            {
                key: 'maintenanceMode',
                type: 'bool',
                label: 'Maintenance mode',
                description: 'Members and visitors see the maintenance screen. Staff keep full access.',
            },
            {
                key: 'allowRegistration',
                type: 'bool',
                label: 'Allow new sign-ups',
                description: 'When off, the sign-up form is closed. Existing members can still sign in.',
            },
        ],
    },
    {
        key: 'users',
        title: 'Accounts',
        description: 'Rules for new and existing accounts.',
        fields: [
            {
                key: 'emailVerification',
                type: 'bool',
                label: 'Require email verification',
                description: 'New members confirm their email before they can post reviews or forum replies.',
            },
            {
                key: 'allowUsernameChange',
                type: 'bool',
                label: 'Allow username changes',
                description: 'Members can rename themselves from their settings.',
            },
            { key: 'minUsernameLength', type: 'int', label: 'Shortest username', min: 1, max: 50, hint: '1 to 50 characters.' },
            { key: 'maxUsernameLength', type: 'int', label: 'Longest username', min: 1, max: 100, hint: '1 to 100 characters.' },
        ],
    },
    {
        key: 'content',
        title: 'Content',
        description: 'What members can post.',
        fields: [
            {
                key: 'enableReviews',
                type: 'bool',
                label: 'Reviews',
                description: 'When off, members can read reviews but not write new ones.',
            },
        ],
    },
];

/** Only the fields that differ, nested by section: `{ general: { maintenanceMode: true } }`. */
export function changedSettings(saved = {}, draft = {}) {
    const changes = {};
    SECTIONS.forEach((section) => {
        section.fields.forEach((field) => {
            const before = saved[section.key]?.[field.key];
            const after = draft[section.key]?.[field.key];
            if (after !== undefined && after !== before) {
                changes[section.key] = { ...(changes[section.key] || {}), [field.key]: after };
            }
        });
    });
    return changes;
}

const fieldPath = (section, field) => `${section}.${field}`;

export default function Settings() {
    const { isSuperuser } = useRole();
    const queryClient = useQueryClient();
    const settings = useAdminQuery(SETTINGS_KEY, ({ signal }) => adminApi.get('settings', undefined, { signal }));
    const [draft, setDraft] = useState(null);
    const [errors, setErrors] = useState({});
    const [confirmMaintenance, setConfirmMaintenance] = useState(false);

    const saved = settings.data;
    useEffect(() => {
        if (saved && draft === null) setDraft(saved);
    }, [saved, draft]);

    const changes = useMemo(() => (saved && draft ? changedSettings(saved, draft) : {}), [saved, draft]);
    const dirty = Object.keys(changes).length > 0;

    const save = useAdminAction(
        (payload) => adminApi.put('settings', payload),
        {
            success: 'Settings saved.',
            error: 'Could not save the settings.',
            onSuccess: (data) => {
                const next = data?.settings || draft;
                queryClient.setQueryData(SETTINGS_KEY, next);
                setDraft(next);
                setErrors({});
            },
            onError: (error) => setErrors(error?.response?.data?.errors || {}),
        },
    );

    const setValue = (section, field, value) => {
        setDraft((current) => ({ ...current, [section]: { ...(current?.[section] || {}), [field]: value } }));
        setErrors((current) => {
            if (!current[fieldPath(section, field)]) return current;
            const next = { ...current };
            delete next[fieldPath(section, field)];
            return next;
        });
    };

    const onToggle = (section, field, value) => {
        if (section === 'general' && field === 'maintenanceMode' && value) {
            setConfirmMaintenance(true);
            return;
        }
        setValue(section, field, value);
    };

    const discard = () => {
        setDraft(saved);
        setErrors({});
    };

    const submit = (event) => {
        event?.preventDefault();
        if (dirty) save.mutate(changes);
    };

    if (settings.error && !saved) {
        return (
            <>
                <PageHeader title="Settings" />
                <Panel><ErrorState error={settings.error} onRetry={() => settings.refetch()} /></Panel>
            </>
        );
    }

    const maintenanceOn = Boolean(saved?.general?.maintenanceMode);
    const sectionErrors = Object.entries(errors).filter(([key]) => !key.includes('.'));

    return (
        <>
            <PageHeader title="Settings" description="Site-wide switches. Changes apply within a few seconds and are kept in the audit log." />

            {!draft ? (
                <div className="space-y-4 sm:space-y-5" aria-busy="true">
                    <PanelSkeleton lines={3} />
                    <PanelSkeleton lines={5} />
                </div>
            ) : (
                <form onSubmit={submit} className="space-y-4 sm:space-y-5">
                    {maintenanceOn && (
                        <Notice tone="warning" title="Maintenance mode is on">
                            Members and visitors see the maintenance screen until it is turned off.
                        </Notice>
                    )}
                    {!isSuperuser && (
                        <Notice title="Read only">Only superusers can change these settings.</Notice>
                    )}
                    {sectionErrors.length > 0 && (
                        <Notice tone="danger" title="Some settings were refused">
                            {sectionErrors.map(([key, message]) => `${key}: ${message}`).join(' ')}
                        </Notice>
                    )}

                    {SECTIONS.map((section) => {
                        const toggles = section.fields.filter((field) => field.type === 'bool');
                        const numbers = section.fields.filter((field) => field.type === 'int');
                        return (
                            <Panel key={section.key} id={`settings-${section.key}`} title={section.title} description={section.description}>
                                {toggles.length > 0 && (
                                    <div className="-my-3">
                                        {toggles.map((field) => (
                                            <div key={field.key}>
                                                <SwitchRow
                                                    label={field.label}
                                                    description={field.description}
                                                    checked={Boolean(draft[section.key]?.[field.key])}
                                                    onChange={(value) => onToggle(section.key, field.key, value)}
                                                    disabled={!isSuperuser || save.isPending}
                                                />
                                                {errors[fieldPath(section.key, field.key)] && (
                                                    <p className="-mt-1 pb-2 text-xs font-medium text-[var(--danger)]">{errors[fieldPath(section.key, field.key)]}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {numbers.length > 0 && (
                                    <div className={`grid gap-4 sm:grid-cols-2 ${toggles.length ? 'mt-5' : ''}`}>
                                        {numbers.map((field) => (
                                            <Field
                                                key={field.key}
                                                label={field.label}
                                                hint={field.hint}
                                                error={errors[fieldPath(section.key, field.key)]}
                                            >
                                                {(id, aria) => (
                                                    <TextInput
                                                        id={id}
                                                        {...aria}
                                                        type="number"
                                                        inputMode="numeric"
                                                        min={field.min}
                                                        max={field.max}
                                                        value={draft[section.key]?.[field.key] ?? ''}
                                                        disabled={!isSuperuser || save.isPending}
                                                        onChange={(event) => {
                                                            const raw = event.target.value;
                                                            const parsed = Number.parseInt(raw, 10);
                                                            setValue(section.key, field.key, Number.isNaN(parsed) ? raw : parsed);
                                                        }}
                                                    />
                                                )}
                                            </Field>
                                        ))}
                                    </div>
                                )}
                            </Panel>
                        );
                    })}

                    {isSuperuser && dirty && (
                        <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center [bottom:max(1rem,env(safe-area-inset-bottom))]">
                            <div
                                role="region"
                                aria-label="Unsaved changes"
                                className="admin-popover pointer-events-auto flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--ink-3)] py-2 pl-4 pr-2 shadow-[var(--shadow-pop)]"
                            >
                                <p className="mr-2 text-sm font-medium text-[var(--text-1)]">You have unsaved changes</p>
                                <Button variant="ghost" size="sm" onClick={discard} disabled={save.isPending}>Discard</Button>
                                <Button variant="primary" size="sm" type="submit" loading={save.isPending}>Save changes</Button>
                            </div>
                        </div>
                    )}
                </form>
            )}

            <ConfirmDialog
                open={confirmMaintenance}
                onClose={() => setConfirmMaintenance(false)}
                title="Turn on maintenance mode?"
                confirmLabel="Turn on"
                tone="danger"
                onConfirm={() => {
                    setValue('general', 'maintenanceMode', true);
                    setConfirmMaintenance(false);
                }}
            >
                After you save, members and visitors see the maintenance screen instead of the site. Staff keep access to
                the site and the admin, so you can turn it off again here.
            </ConfirmDialog>
        </>
    );
}
