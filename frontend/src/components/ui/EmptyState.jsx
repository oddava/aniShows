/**
 * The one empty state: a short title, a sentence that says what to do, and at
 * most two actions. No illustrations, no zero walls.
 */
export default function EmptyState({ icon: Icon, title, children, actions, className = '', compact = false }) {
    return (
        <div className={`rounded-[var(--radius-lg)] bg-white/[0.025] text-center ${compact ? 'px-5 py-8' : 'px-6 py-12'} ${className}`}>
            {Icon && (
                <span aria-hidden="true" className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] text-gray-400">
                    <Icon className="h-5 w-5" />
                </span>
            )}
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-400">{children}</div>}
            {actions && <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">{actions}</div>}
        </div>
    );
}
