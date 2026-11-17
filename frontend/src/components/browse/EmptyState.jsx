import { Search, SearchX, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';

const TRENDING_LINK = '/browse?sort=trending';

/**
 * Shown when a browse query returns nothing. It says why (search vs filters)
 * and offers the actions that get results back (B23): a search narrowed by
 * filters can run on the whole catalog, a search alone points at what's
 * trending.
 */
export default function EmptyState({
  onClearFilters,
  onSearchWithoutFilters,
  hasActiveFilters,
  searchQuery = '',
}) {
  const canReset = hasActiveFilters || Boolean(searchQuery);

  return (
    <div className="ui-empty-state my-4" role="status">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-dark-200 mb-5">
        <SearchX aria-hidden="true" className="w-6 h-6 text-gray-500" />
      </div>

      <h3 className="text-lg font-semibold text-white mb-2">
        No results found
      </h3>

      <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">
        {searchQuery ? (
          <>Nothing matches &ldquo;<span className="text-gray-200">{searchQuery}</span>&rdquo;{hasActiveFilters ? ' with these filters' : ''}. Check the spelling, or try the English or Japanese title.</>
        ) : hasActiveFilters ? (
          'No anime match these filters. Try removing one or two.'
        ) : (
          'There is nothing to show here yet.'
        )}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {searchQuery && hasActiveFilters && onSearchWithoutFilters && (
          <button type="button" onClick={onSearchWithoutFilters} className="btn-secondary text-sm">
            <Search aria-hidden="true" className="w-4 h-4" />
            Search all anime for &ldquo;{searchQuery}&rdquo;
          </button>
        )}
        {canReset && (
          <button type="button" onClick={onClearFilters} className="btn-secondary text-sm">
            <X aria-hidden="true" className="w-4 h-4" />
            {searchQuery && !hasActiveFilters ? 'Clear search' : 'Clear filters'}
          </button>
        )}
        {(!canReset || (searchQuery && !hasActiveFilters)) && (
          <Link to={TRENDING_LINK} className="btn-secondary text-sm">
            See what&rsquo;s trending
          </Link>
        )}
      </div>
    </div>
  );
}

EmptyState.propTypes = {
  onClearFilters: PropTypes.func.isRequired,
  onSearchWithoutFilters: PropTypes.func,
  hasActiveFilters: PropTypes.bool.isRequired,
  searchQuery: PropTypes.string,
};
