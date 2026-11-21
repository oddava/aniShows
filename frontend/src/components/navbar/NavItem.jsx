import { NavLink } from 'react-router-dom';

/** A header link set like oddava.me's: plain text; the current page gets an accent underline. */
export default function NavItem({ to, label, end = false }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `relative flex min-h-11 items-center text-[15px] transition-colors ${isActive
                ? 'text-[var(--text-1)] after:absolute after:inset-x-0 after:bottom-2 after:h-[1.5px] after:rounded-full after:bg-[var(--signature)]'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
        >
            {label}
        </NavLink>
    );
}
