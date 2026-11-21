import { Grid3X3, List, LayoutGrid } from 'lucide-react';
import PropTypes from 'prop-types';

const VIEW_MODES = [
  { value: 'grid', label: 'Grid', icon: Grid3X3 },
  { value: 'list', label: 'List', icon: List },
  { value: 'minimal', label: 'Minimal', icon: LayoutGrid },
];

export default function ViewModeToggle({ viewMode, onChange, showLabels = false }) {
  return (
    <div role="group" aria-label="View" className="flex items-center rounded-lg bg-white/[0.05] p-0.5">
      {VIEW_MODES.map((mode) => {
        const Icon = mode.icon;
        const isActive = viewMode === mode.value;
        
        return (
          <button
            key={mode.value}
            onClick={() => onChange(mode.value)}
            title={mode.label}
            aria-label={`${mode.label} view`}
            className={`flex h-9 min-w-10 items-center justify-center gap-1.5 px-2.5 rounded-md transition-colors duration-150
              ${isActive
                ? 'bg-white/[0.1] text-[var(--text-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
              }`}
            aria-pressed={isActive}
          >
            <Icon aria-hidden="true" className="w-4 h-4" />
            {showLabels && (
              <span className={`text-xs font-medium ${isActive ? 'text-white' : ''}`}>
                {mode.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

ViewModeToggle.propTypes = {
  viewMode: PropTypes.oneOf(['grid', 'list', 'minimal']).isRequired,
  onChange: PropTypes.func.isRequired,
  showLabels: PropTypes.bool
};

ViewModeToggle.defaultProps = {
  showLabels: false
};