const BulkActions = ({ 
  selectedCount, 
  actions = [],
  onClearSelection 
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-violet-500/10 border-y border-violet-500/20">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-violet-300">
          {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
        </span>
        <button
          onClick={onClearSelection}
          className="text-sm text-white/50 hover:text-white transition-colors"
        >
          Clear selection
        </button>
      </div>
      
      <div className="flex items-center gap-2">
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={action.onClick}
            disabled={action.disabled}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              action.variant === 'danger'
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50'
                : action.variant === 'primary'
                ? 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 disabled:opacity-50'
                : 'bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-50'
            }`}
          >
            {action.icon && <span>{action.icon}</span>}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default BulkActions;
