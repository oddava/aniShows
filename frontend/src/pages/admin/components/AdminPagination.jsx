import PropTypes from 'prop-types';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const BUTTON = 'px-4 py-2 min-h-[44px] sm:min-h-0 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1';

/** Previous / next pager under an admin table; renders nothing for one page. */
export default function AdminPagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 px-4 sm:px-6 py-4 border-t border-white/10">
      <span className="text-sm text-white/50">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className={BUTTON}
        >
          <ChevronLeft size={16} aria-hidden="true" /> Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className={BUTTON}
        >
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

AdminPagination.propTypes = {
  page: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  onPageChange: PropTypes.func.isRequired,
};
