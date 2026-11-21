import { Link } from 'react-router-dom';

/**
 * The site's section header: a sentence-case heading and, optionally, a quiet
 * "See all" text link (accent text, no underline). One definition so Home
 * and Browse rows read the same.
 */
export default function SectionHeader({
    id,
    title,
    subtitle,
    viewAllTo,
    viewAllLabel = 'See all',
    onViewAllClick,
    className = '',
}) {
    return (
        <div className={`flex ${subtitle ? 'items-end' : 'items-center'} justify-between gap-4 mb-5 md:mb-6 ${className}`}>
            <div className="min-w-0">
                <h2 id={id} className="section-title">{title}</h2>
                {subtitle && <p className="text-[15px] text-[var(--text-2)] mt-1">{subtitle}</p>}
            </div>
            {viewAllTo && (
                <Link
                    to={viewAllTo}
                    onClick={onViewAllClick}
                    className="text-link shrink-0 text-[15px]"
                    aria-label={`${viewAllLabel}: ${title}`}
                >
                    {viewAllLabel}
                </Link>
            )}
        </div>
    );
}
