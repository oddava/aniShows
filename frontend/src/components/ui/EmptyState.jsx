/**
 * The one empty state: plain text (no card, no icon circle): a short title,
 * a sentence that says what to do, and at most two actions.
 */
export default function EmptyState({ title, children, actions, className = '', compact = false }) {
    return (
        <div className={`text-center ${compact ? 'py-8' : 'py-14'} ${className}`}>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-400">{children}</div>}
            {actions && <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">{actions}</div>}
        </div>
    );
}
