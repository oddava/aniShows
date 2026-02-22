import { SearchX, Sparkles, RotateCcw, Filter } from 'lucide-react';
import PropTypes from 'prop-types';

export default function EmptyState({ 
  onClearFilters, 
  hasActiveFilters,
  searchQuery,
  suggestions = []
}) {
  return (
    <div className="text-center py-16 px-4">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-dark-100 rounded-2xl mb-6 border border-gray-800">
        <SearchX className="w-10 h-10 text-gray-500" />
      </div>
      
      <h3 className="text-xl font-bold text-white mb-2">
        No results found
      </h3>
      
      <p className="text-gray-400 max-w-md mx-auto mb-6">
        {searchQuery ? (
          <>We couldn't find any anime matching "<span className="text-accent">{searchQuery}</span>"</>
        ) : hasActiveFilters ? (
          "No anime match your current filters. Try adjusting them to see more results."
        ) : (
          "There are no anime to display at the moment."
        )}
      </p>

      {suggestions.length > 0 && (
        <div className="mb-8">
          <p className="text-sm text-gray-500 mb-3 flex items-center justify-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            You might like:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {/* Navigate to suggestion */}}
                className="px-3 py-1.5 bg-dark-100 text-gray-300 rounded-lg text-sm border border-gray-700 hover:border-accent hover:text-white transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {hasActiveFilters && (
          <button 
            onClick={onClearFilters}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            <Filter className="w-4 h-4" />
            Clear Filters
          </button>
        )}
        <button 
          onClick={() => window.location.reload()}
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Refresh
        </button>
      </div>
    </div>
  );
}

EmptyState.propTypes = {
  onClearFilters: PropTypes.func.isRequired,
  hasActiveFilters: PropTypes.bool.isRequired,
  searchQuery: PropTypes.string,
  suggestions: PropTypes.arrayOf(PropTypes.string)
};

EmptyState.defaultProps = {
  searchQuery: '',
  suggestions: []
};