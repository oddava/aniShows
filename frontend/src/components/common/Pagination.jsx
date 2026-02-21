import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center gap-4 py-4">
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 bg-dark-100 border border-gray-800 text-gray-300 hover:text-white hover:bg-white/5 hover:border-gray-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-800/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
            >
                <ChevronLeft size={16} />
                <span>Prev</span>
            </button>

            <span className="text-sm font-medium text-gray-400">
                Page <span className="text-white">{currentPage}</span> of <span className="text-white">{totalPages}</span>
            </span>

            <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-2 bg-dark-100 border border-gray-800 text-gray-300 hover:text-white hover:bg-white/5 hover:border-gray-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-800/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
            >
                <span>Next</span>
                <ChevronRight size={16} />
            </button>
        </div>
    );
};

export default Pagination;
