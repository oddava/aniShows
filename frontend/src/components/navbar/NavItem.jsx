import { NavLink } from 'react-router-dom';

// Navigation Item Component with Active State
export default function NavItem({ to, label, end = false }) {
    return (
        <NavLink
            to={to}
            end={end}
            title={label}
            className={({ isActive }) => `
                relative flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300
                ${isActive
                    ? 'text-white bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
            `}
        >
            <span className="tracking-wide">{label}</span>
        </NavLink>
    );
}
