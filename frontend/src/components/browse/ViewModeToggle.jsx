import { Grid3X3, List, LayoutGrid } from 'lucide-react';
import PropTypes from 'prop-types';

const VIEW_MODES = [
  { value: 'grid', label: 'Grid', icon: Grid3X3 },
  { value: 'list', label: 'List', icon: List },
  { value: 'minimal', label: 'Minimal', icon: LayoutGrid },
];

export default function ViewModeToggle({ viewMode, onChange, showLabels = false }) {
  return (
    <div className="flex items-center bg-dark-100 border border-gray-700 rounded-lg p-0.5">
      {VIEW_MODES.map((mode) => {
        const Icon = mode.icon;
        const isActive = viewMode === mode.value;
        
        return (
          <button
            key={mode.value}
            onClick={() => onChange(mode.value)}
            title={mode.label}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all duration-200
              ${isActive
                ? 'bg-accent text-white shadow-sm shadow-accent/20' 
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            aria-pressed={isActive}
          >
            <Icon className="w-3.5 h-3.5" />
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