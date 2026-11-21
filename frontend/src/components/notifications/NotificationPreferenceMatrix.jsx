import { useId } from 'react';
import SettingsSwitch from '../settings/SettingsSwitch';

// Desktop grid: the label column plus one column per channel. Literal class
// strings so Tailwind sees them.
const GRID_COLUMNS = {
    1: 'sm:grid-cols-[minmax(0,1fr)_5.5rem]',
    2: 'sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem]',
    3: 'sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem]',
    4: 'sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_5.5rem]',
};

/**
 * The preferences matrix: one row per category and one column per channel,
 * exactly as the server's `schema` describes them (a cell exists only where
 * the category offers that channel). On phones each row stacks its switches
 * with their labels.
 *
 * `push` is `{available, ready}`: when push isn't available on the server the
 * Push column is left out with a note; until this device has push turned on
 * (`ready`) the column is disabled with a hint.
 */
export default function NotificationPreferenceMatrix({
    schema,
    preferences,
    savingKeys = {},
    onToggle,
    push = { available: true, ready: true },
    statusMessage = '',
    status = '',
    isLoading = false,
    loadError = false,
    onRetry,
}) {
    const baseId = useId();
    const pushHintId = `${baseId}-push-hint`;
    const lockedHintId = `${baseId}-locked-hint`;
    const inAppHintId = `${baseId}-in-app-hint`;

    const channels = (schema?.channels || []).filter((channel) => channel.key !== 'push' || push.available);
    const categories = schema?.categories || [];
    const gridColumns = GRID_COLUMNS[channels.length] || '';
    const hasPushColumn = channels.some((channel) => channel.key === 'push');

    return (
        <section className="panel">
            <h2 className="section-title">What reaches you</h2>
            <p className="mt-1 text-sm text-[var(--text-2)]">Choose where each kind of notification reaches you.</p>

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="w-8 h-8 border-2 border-[var(--signature)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                </div>
            ) : loadError || !schema ? (
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-[var(--text-2)]">Your notification settings couldn’t be loaded.</p>
                    {onRetry && (
                        <button type="button" onClick={() => onRetry()} className="btn-secondary text-sm shrink-0">
                            Retry
                        </button>
                    )}
                </div>
            ) : (
                <>
                    {hasPushColumn && !push.ready && (
                        <p id={pushHintId} className="mt-2 text-sm text-[var(--text-2)]">Enable push on this device first</p>
                    )}
                    {!push.available && (
                        <p className="mt-2 text-sm text-[var(--text-2)]">Push isn’t available right now, so it isn’t listed.</p>
                    )}
                    <span id={lockedHintId} className="sr-only">Always on</span>
                    <span id={inAppHintId} className="sr-only">Turn on In-app first</span>

                    <div className="mt-5">
                        <div
                            aria-hidden="true"
                            className={`hidden sm:grid ${gridColumns} gap-x-4 pb-2`}
                        >
                            <span />
                            {channels.map((channel) => (
                                <span key={channel.key} className="text-center text-sm font-medium text-[var(--text-2)]">
                                    {channel.label}
                                </span>
                            ))}
                        </div>

                        <div>
                            {categories.map((category) => {
                                const labelId = `${baseId}-${category.key}`;
                                return (
                                    <div
                                        key={category.key}
                                        role="group"
                                        aria-labelledby={labelId}
                                        className={`py-3 sm:grid ${gridColumns} sm:items-center sm:gap-x-4`}
                                    >
                                        <div className="pr-2">
                                            <p id={labelId} className="text-[15px] font-medium leading-5 text-[var(--text-1)]">
                                                {category.label}
                                            </p>
                                            {category.description && (
                                                <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">{category.description}</p>
                                            )}
                                        </div>

                                        <div className="mt-2 space-y-1 sm:contents">
                                            {channels.map((channel) => {
                                                if (!category.channels?.includes(channel.key)) {
                                                    return <div key={channel.key} aria-hidden="true" className="hidden sm:block" />;
                                                }
                                                const locked = Boolean(category.locked?.includes(channel.key));
                                                const pushBlocked = channel.key === 'push' && !push.ready;
                                                // Push and email are only sent for rows that exist in-app.
                                                const needsInApp = channel.key !== 'in_app'
                                                    && category.channels?.includes('in_app')
                                                    && !preferences?.[category.key]?.in_app;
                                                const saving = `${category.key}.${channel.key}` in savingKeys;
                                                const checked = Boolean(preferences?.[category.key]?.[channel.key]);
                                                return (
                                                    <div
                                                        key={channel.key}
                                                        className="flex min-h-11 items-center justify-between gap-4 sm:justify-center"
                                                    >
                                                        <span aria-hidden="true" className="text-sm text-[var(--text-2)] sm:hidden">
                                                            {channel.label}
                                                        </span>
                                                        <SettingsSwitch
                                                            checked={checked}
                                                            label={`${channel.label} for ${category.label}`}
                                                            disabled={locked || pushBlocked || needsInApp || saving}
                                                            describedBy={
                                                                locked ? lockedHintId
                                                                    : needsInApp ? inAppHintId
                                                                        : pushBlocked ? pushHintId : undefined
                                                            }
                                                            onClick={() => onToggle(category.key, channel.key)}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            <p
                role="status"
                className={`mt-2 text-sm ${status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}
            >
                {statusMessage}
            </p>
        </section>
    );
}
