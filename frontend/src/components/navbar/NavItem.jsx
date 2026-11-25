import { Link } from 'react-router-dom';

/**
 * A header link: plain text; the current page sits on a soft fill (no
 * underline). `active` comes from the address bar (usePendingPath), so the
 * fill moves on the click, not when the next page has finished loading.
 */
export default function NavItem({ to, label, active = false }) {
    return (
        <Link
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`relative flex h-10 items-center rounded-lg px-3 text-[15px] transition-colors duration-150 ${active
                ? 'bg-white/[0.07] font-medium text-[var(--text-1)]'
                : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`}
        >
            {label}
        </Link>
    );
}
