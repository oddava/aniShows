/**
 * A soft chip with a word ("Active", "Removed", "Superuser"). Tones come from
 * the site's fixed palette; colour always comes with the word, never alone.
 */
export const CHIP_TONES = {
    neutral: 'bg-white/[0.06] text-[var(--text-2)]',
    accent: 'bg-[var(--signature-soft)] text-[var(--signature)]',
    success: 'bg-[var(--success-soft)] text-[var(--success)]',
    warning: 'bg-[var(--warning-soft)] text-[var(--status-on-hold)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    violet: 'bg-[var(--violet-soft)] text-[var(--violet)]',
};

const DOT_TONES = {
    neutral: 'bg-[var(--text-3)]',
    accent: 'bg-[var(--signature)]',
    success: 'bg-[var(--success)]',
    warning: 'bg-[var(--status-on-hold)]',
    danger: 'bg-[var(--danger)]',
    violet: 'bg-[var(--violet)]',
};

export default function Chip({ tone = 'neutral', dot = false, children, className = '', title }) {
    return (
        <span
            title={title}
            className={`inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-semibold ${CHIP_TONES[tone] || CHIP_TONES.neutral} ${className}`}
        >
            {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONES[tone] || DOT_TONES.neutral}`} />}
            <span className="truncate">{children}</span>
        </span>
    );
}

/** A coloured dot plus its word, for inline states in dense rows. */
export function StateDot({ tone = 'neutral', children, className = '' }) {
    return (
        <span className={`inline-flex items-center gap-2 text-sm text-[var(--text-2)] ${className}`}>
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT_TONES[tone] || DOT_TONES.neutral}`} />
            {children}
        </span>
    );
}

/** Account state for a user row: Active, Suspended, plus their role. */
export function UserStateChips({ user }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            {user.is_active === false
                ? <Chip tone="danger" dot>Suspended</Chip>
                : <Chip tone="success" dot>Active</Chip>}
            {user.is_superuser
                ? <Chip tone="violet">Superuser</Chip>
                : user.is_staff && <Chip tone="accent">Staff</Chip>}
        </span>
    );
}
