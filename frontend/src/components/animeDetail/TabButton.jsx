import { memo } from 'react';
import { Link } from 'react-router-dom';

// One tab of the detail page: plain text, the active one in primary text with
// an accent tab indicator under it, never a filled pill.
const TabButton = memo(({ tab, isActive, to, count }) => {
    return (
        <Link
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className={`relative inline-flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[15px] font-medium transition-colors first:pl-0
                after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full first:after:left-0
                ${isActive
                    ? 'text-[var(--text-1)] after:bg-[var(--signature)]'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)] after:bg-transparent'}`}
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
