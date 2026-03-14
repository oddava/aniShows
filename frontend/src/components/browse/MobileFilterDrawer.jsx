import { useEffect } from 'react';
import { X, Filter, Loader2 } from 'lucide-react';
import PropTypes from 'prop-types';
import FilterSidebar from './FilterSidebar';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export default function MobileFilterDrawer({
  isOpen,
  onClose,
  onApply,
  isApplying,
  filterSidebarProps
}) {
  const drawerRef = useFocusTrap(isOpen, onClose);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (!isOpen) return;
    
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.body.style.overflow = originalStyle;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] lg:hidden" ref={drawerRef}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70  animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-[360px] sm:max-w-[380px] bg-dark-100 border-l border-gray-700 overflow-hidden flex flex-col ">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-dark-100 border-b border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-accent/10 rounded-lg">
              <Filter className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-lg font-bold text-white">Filters</h2>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-dark-50 text-gray-400 hover:text-white hover:bg-dark-200 transition-colors"
            aria-label="Close filters"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
          <FilterSidebar {...filterSidebarProps} isMobile={true} />
        </div>
        
        {/* Footer */}
        <div className="sticky bottom-0 bg-dark-100 border-t border-gray-700 p-4">
          <button
            onClick={onApply}
            disabled={isApplying}
            className="w-full py-3 text-sm font-bold flex items-center justify-center gap-2 text-white bg-accent hover:bg-accent-dark rounded-xl transition-colors   disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isApplying ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Applying...
              </>
            ) : (
              'Apply Filters'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

MobileFilterDrawer.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onApply: PropTypes.func.isRequired,
  isApplying: PropTypes.bool.isRequired,
  filterSidebarProps: PropTypes.shape({
    genres: PropTypes.array,
    studios: PropTypes.array,
    isGenresError: PropTypes.bool,
    isStudiosError: PropTypes.bool,
    localFilters: PropTypes.object.isRequired,
    collapsedSections: PropTypes.object.isRequired,
    onToggleSection: PropTypes.func.isRequired,
    onUpdateFilter: PropTypes.func.isRequired,
    onToggleGenre: PropTypes.func.isRequired,
    hasUnappliedChanges: PropTypes.bool.isRequired,
    onApplyFilters: PropTypes.func.isRequired,
    onResetFilters: PropTypes.func.isRequired,
    typeOptions: PropTypes.array.isRequired,
    statusOptions: PropTypes.array.isRequired,
    seasonOptions: PropTypes.array.isRequired,
    yearOptions: PropTypes.array.isRequired
  }).isRequired
};