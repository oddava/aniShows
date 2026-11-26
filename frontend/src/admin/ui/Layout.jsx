import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

/**
 * The top of every admin page: a sentence-case title, one line on what the
 * page is for, the page's main actions on the right, and (on detail pages) a
 * way back.
 */
export function PageHeader({ title, description, actions, back, meta, children }) {
    return (
        <header className="mb-6 sm:mb-8">
            {back && (
                <Link
                    to={back.to}
                    className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    {back.label}
                </Link>
            )}
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                <div className="min-w-0">
                    <h1 className="text-[1.75rem] font-[650] leading-tight tracking-[-0.03em] text-[var(--text-1)] sm:text-[2rem] [overflow-wrap:anywhere]">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-2)] sm:text-[0.9375rem]">
                            {description}
                        </p>
                    )}
                    {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </header>
    );
}

/**
 * A section on a raised slate panel (the site's `.panel`). Sections are told
 * apart by panels, never by lines; nothing inside a panel gets its own panel.
 */
export function Panel({
    title,
    description,
    actions,
    children,
    className = '',
    bodyClassName = '',
    padded = true,
    as: Tag = 'section',
    id,
    ...rest
}) {
    const headingId = id ? `${id}-title` : undefined;
    return (
        <Tag
            id={id}
            aria-labelledby={title && headingId ? headingId : undefined}
            className={`min-w-0 rounded-[var(--radius-lg)] bg-[var(--ink-1)] ${padded ? 'p-4 sm:p-5' : ''} ${className}`}
            {...rest}
        >
            {(title || actions) && (
                <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${padded ? 'mb-4' : 'px-4 pt-4 sm:px-5 sm:pt-5 mb-3'}`}>
                    <div className="min-w-0">
                        {title && <h2 id={headingId} className="section-title !text-base sm:!text-[1.0625rem]">{title}</h2>}
                        {description && <p className="mt-0.5 text-sm text-[var(--text-2)]">{description}</p>}
                    </div>
                    {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
                </div>
            )}
            <div className={bodyClassName}>{children}</div>
        </Tag>
    );
}

/** A row of list controls (search, filters) that wraps on small screens. */
export function Toolbar({ children, className = '' }) {
    return (
        <div className={`mb-4 flex flex-wrap items-center gap-2 ${className}`}>
            {children}
        </div>
    );
}

/**
 * Label/value pairs for detail views.
 *   <KeyValue items={[{ label: 'Joined', value: formatDate(user.date_joined) }]} />
 * Items with `hidden: true` are skipped; empty values show a dash.
 */
export function KeyValue({ items, columns = 2, className = '' }) {
    const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns] || 'sm:grid-cols-2';
    return (
        <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${cols} ${className}`}>
            {items.filter((item) => item && !item.hidden).map((item) => (
                <div key={item.label} className={`min-w-0 ${item.wide ? 'sm:col-span-full' : ''}`}>
                    <dt className="text-xs font-medium text-[var(--text-3)]">{item.label}</dt>
                    <dd className="mt-1 text-sm text-[var(--text-1)] [overflow-wrap:anywhere]">
                        {item.value === null || item.value === undefined || item.value === '' ? <span className="text-[var(--text-3)]">—</span> : item.value}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

/** A small muted line of facts separated by middots: "12 reviews · joined 3 May 2025". */
export function MetaLine({ items, className = '' }) {
    const parts = items.filter(Boolean);
    return (
        <p className={`text-sm text-[var(--text-2)] ${className}`}>
            {parts.map((part, index) => (
                <span key={index}>
                    {index > 0 && <span aria-hidden="true" className="px-1.5 text-[var(--text-3)]">·</span>}
                    {part}
                </span>
            ))}
        </p>
    );
}
