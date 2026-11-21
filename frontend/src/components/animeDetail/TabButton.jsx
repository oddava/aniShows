import { memo } from 'react';
import { Link } from 'react-router-dom';

// One tab of the detail page: plain text; the active one sits on a soft fill
// (no lines, no underline).
const TabButton = memo(({ tab, isActive, to, count }) => {
    return (
        <Link
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[15px] sm:px-3.5 font-medium transition-colors
                ${isActive
                    ? 'bg-white/[0.07] text-[var(--text-1)]'
                    : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`}
        >
            {tab.label}
            {count > 0 && (
                <span className="tabular text-sm font-normal text-[var(--text-3)]">
                    {count}
                </span>
            )}
        </Link>
    );
});

TabButton.displayName = 'TabButton';

export default TabButton;
