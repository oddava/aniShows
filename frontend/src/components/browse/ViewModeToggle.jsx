import { Grid3X3, List, LayoutGrid } from 'lucide-react';
import PropTypes from 'prop-types';
import useActivePill from '../../hooks/useActivePill';

const VIEW_MODES = [
  { value: 'grid', label: 'Grid', icon: Grid3X3 },
  { value: 'list', label: 'List', icon: List },
  { value: 'minimal', label: 'Minimal', icon: LayoutGrid },
];

export default function ViewModeToggle({ viewMode, onChange, showLabels = false }) {
  const pill = useActivePill();
  return (
    <div ref={pill.hostRef} role="group" aria-label="View" className="pill-host flex items-center rounded-lg bg-white/[0.05] p-0.5" style={{ '--pill-bg': 'rgb(255 255 255 / 0.1)', '--pill-radius': '0.375rem' }}>
      <span ref={pill.pillRef} aria-hidden="true" className="active-pill" />
      {VIEW_MODES.map((mode) => {
        const Icon = mode.icon;
        const isActive = viewMode === mode.value;
        
        return (
          <button
            key={mode.value}
            type="button"
            onClick={() => onChange(mode.value)}
            title={mode.label}
            aria-label={`${mode.label} view`}
            className={`relative flex h-9 min-w-10 items-center justify-center gap-1.5 px-2.5 rounded-md after:absolute after:-inset-1 after:content-[''] transition-colors duration-150
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