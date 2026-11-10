import { memo } from 'react';
import { Link } from 'react-router-dom';

// Memoized tab button component
const TabButton = memo(({ tab, isActive, to, accentColor, count }) => {
    return (
        <Link
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 min-h-[40px] sm:min-h-0
                ${isActive
                    ? 'text-white '
                    : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            style={isActive ? {
                backgroundColor: accentColor || '#75698d'
            } : {}}
        >
            {tab.label}
            {count > 0 && (
                <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/20' : 'bg-white/5'}`}>
                    {count}
                </span>
            )}
        </Link>
    );
});

TabButton.displayName = 'TabButton';

export default TabButton;
