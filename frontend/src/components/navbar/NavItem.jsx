import { NavLink } from 'react-router-dom';

/** A header link set like oddava.me's: plain text; the current page is simply brighter. */
export default function NavItem({ to, label, end = false }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `relative flex min-h-11 items-center text-[15px] transition-colors ${isActive
                ? 'text-[var(--text-1)] font-medium'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
        >
            {label}
        </NavLink>
    );
}
