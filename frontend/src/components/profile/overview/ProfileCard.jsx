import { ChevronRight } from 'lucide-react';

/**
 * One overview section on its own soft panel: a title and a quiet
 * "see all" on the right.
 */
export default function ProfileCard({
    title,
    onSeeAll,
    seeAllLabel,
    className = '',
    bodyClassName = '',
    children,
    as: Tag = 'section',
}) {
    return (
        <Tag className={`profile-card min-w-0 ${className}`}>
            {title && (
                <div className="mb-4 flex items-center justify-between gap-4">
                    <h2 className="profile-card-title min-w-0">{title}</h2>
                    {onSeeAll && (
                        <button
                            type="button"
                            onClick={onSeeAll}
                            // Starts with the visible "See all" (WCAG 2.5.3, RA-004).
                            aria-label={`See all: ${seeAllLabel || title}`}
                            className="-my-2 inline-flex min-h-[2.75rem] shrink-0 items-center gap-0.5 text-sm font-medium text-[var(--signature)] transition-colors hover:text-[var(--signature-hover)]"
                        >
                            See all
                            <ChevronRight aria-hidden="true" className="h-4 w-4" />
                        </button>
                    )}
                </div>
            )}
            <div className={bodyClassName}>{children}</div>
        </Tag>
    );
}
