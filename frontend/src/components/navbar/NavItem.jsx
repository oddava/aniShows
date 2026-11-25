import { NavLink } from 'react-router-dom';

/** A header link: plain text; the current page sits on a soft fill (no underline). */
export default function NavItem({ to, label, end = false }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `relative flex h-10 items-center press rounded-lg px-3 text-[15px] transition-colors duration-150 ${isActive
                ? 'bg-white/[0.06] font-medium text-[var(--text-1)]'
                : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`}
        >
            {label}
        </NavLink>
    );
}
