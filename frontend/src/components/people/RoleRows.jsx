import { Link } from 'react-router-dom';
import CoverThumb, { animeCoverSources } from '../ui/CoverThumb';

/**
 * Shared pieces of the character and staff pages: role rows (cover, title,
 * the people involved, the role on the right), people links and the
 * "Show all" button.
 */

/** "MAIN" → "Main", "SUPPORTING" → "Supporting"; mixed-case text is kept. */
export function roleLabel(role) {
    const text = String(role || '').trim().replace(/_/g, ' ');
    if (!text || text !== text.toUpperCase()) return text;
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const animeHref = (anime) => (anime?.slug ? `/anime/${anime.slug}` : '#');

/** A list of rows: one column on phones, two on wide screens. */
export function RoleList({ children }) {
    return <ul className="-mx-3 grid grid-cols-1 gap-x-10 gap-y-1 lg:grid-cols-2">{children}</ul>;
}

/**
 * One anime: its cover (a decorative duplicate of the title link), the title,
 * an optional detail line, and `meta` right-aligned.
 */
export function RoleRow({ anime, meta, children }) {
    const href = animeHref(anime);
    return (
        <li className="group grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-4 rounded-[var(--radius-md)] px-3 py-3 transition-colors duration-150 hover:bg-white/[0.03]">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="block">
                <CoverThumb sources={animeCoverSources(anime, 'small')} className="h-20 w-14 rounded-[var(--radius-sm)]" />
            </Link>
            <div className="min-w-0">
                <Link
                    to={href}
                    className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--text-1)] transition-colors duration-150 hover:text-[var(--signature)]"
                >
                    {anime?.title}
                </Link>
                {children && <div className="mt-1 text-sm leading-snug text-[var(--text-2)]">{children}</div>}
            </div>
            {meta ? (
                <span className="self-center whitespace-nowrap text-right text-sm text-[var(--text-3)]">{meta}</span>
            ) : <span />}
        </li>
    );
}

/** Comma-separated people links (characters or voice actors). */
export function PeopleLinks({ people, pathFor }) {
    if (!people?.length) return null;
    return (
        <p className="line-clamp-2">
            {people.map((person, index) => (
                <span key={person.id ?? person.name}>
                    {index > 0 && ', '}
                    <Link to={pathFor(person)} className="transition-colors duration-150 hover:text-[var(--text-1)]">
                        {person.name}
                    </Link>
                </span>
            ))}
        </p>
    );
}

export function ShowAllButton({ total, onClick }) {
    return (
        <div className="mt-6">
            <button type="button" onClick={onClick} className="btn-secondary text-sm">
                Show all {total}
            </button>
        </div>
    );
}

/** Loading placeholder rows in the same geometry. */
export function RoleListSkeleton({ count = 6 }) {
    return (
        <div className="grid grid-cols-1 gap-x-10 gap-y-1 lg:grid-cols-2" aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className="flex items-center gap-4 py-3">
                    <div className="h-20 w-14 shrink-0 rounded-[var(--radius-sm)] bg-white/[0.05]" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 w-2/3 rounded bg-white/[0.05]" />
                        <div className="h-3.5 w-1/3 rounded bg-white/[0.05]" />
                    </div>
                </div>
            ))}
        </div>
    );
}
