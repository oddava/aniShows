/**
 * The auth pages, set like the rest of the site: a page title and one plain
 * line on the left, the form on the right (stacked on phones). No card.
 */
export default function AuthLayout({ title, lead, children }) {
    return (
        <div className="page-container pb-20 pt-12 md:pt-24">
            <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
                <div>
                    <h1 className="page-title">{title}</h1>
                    {lead && (
                        <p className="mt-3 max-w-sm text-[17px] leading-relaxed text-[var(--text-2)]">{lead}</p>
                    )}
                </div>
                <div className="w-full max-w-md">{children}</div>
            </div>
        </div>
    );
}

/** "or with email" between the Google button and the form. */
export function AuthDivider({ children = 'Or with email' }) {
    return (
        <div className="my-8 flex items-center gap-4 text-sm text-[var(--text-2)]">
            <span aria-hidden="true" className="h-px flex-1 bg-white/[0.08]" />
            {children}
            <span aria-hidden="true" className="h-px flex-1 bg-white/[0.08]" />
        </div>
    );
}

/** A message for the whole form: an error (role="alert") or a confirmation (role="status"). */
export function AuthNotice({ tone = 'error', children, className = '' }) {
    const isError = tone === 'error';
    return (
        <div
            role={isError ? 'alert' : 'status'}
            className={`rounded-[var(--radius-md)] border px-4 py-3 text-[15px] leading-relaxed ${isError
                ? 'border-red-400/30 text-red-300'
                : 'border-[var(--line-3)] text-[var(--text-1)]'} ${className}`}
        >
            {children}
        </div>
    );
}
