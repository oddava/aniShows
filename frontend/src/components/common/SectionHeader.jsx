import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * The site's section header: a small uppercase label and, optionally, a quiet
 * "View All" link. One definition so Home and Browse rows read the same.
 */
export default function SectionHeader({
    id,
    title,
    subtitle,
    viewAllTo,
    viewAllLabel = 'View All',
    onViewAllClick,
    className = '',
}) {
    return (
        <div className={`flex items-end justify-between gap-4 mb-5 md:mb-6 ${className}`}>
            <div className="min-w-0">
                <h2 id={id} className="section-title">{title}</h2>
                {subtitle && <p className="text-sm text-gray-500 mt-1.5">{subtitle}</p>}
            </div>
            {viewAllTo && (
                <Link
                    to={viewAllTo}
                    onClick={onViewAllClick}
                    className="group shrink-0 inline-flex items-center gap-0.5 rounded-md text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    aria-label={`${viewAllLabel}: ${title}`}
                >
                    {viewAllLabel}
                    <ChevronRight aria-hidden="true" className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
            )}
        </div>
    );
}
