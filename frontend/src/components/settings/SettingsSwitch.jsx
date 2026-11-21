/**
 * The on/off switch used across Settings, notification preferences and the
 * AniList sync: a soft track that fills with the accent when on (same look
 * as the list editor's switch). The visible track is 24 px tall; an
 * invisible pseudo-element pads the hit area to 44 px for touch.
 */
export default function SettingsSwitch({
    checked,
    onClick,
    disabled = false,
    label,
    labelledBy,
    describedBy,
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            onClick={onClick}
            disabled={disabled}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-[var(--ease-out)] motion-reduce:transition-none before:absolute before:-inset-y-2.5 before:-inset-x-0.5 before:content-['']
            ${checked ? 'bg-[var(--signature)]' : 'bg-white/10'}
            ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
            <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-white transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
        </button>
    );
}
