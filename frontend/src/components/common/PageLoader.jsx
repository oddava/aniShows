import React from 'react';

/**
 * Route-level fallback while a page chunk loads. It stays invisible for the
 * first 300 ms, so quick navigations never flash a spinner.
 */
export default function PageLoader() {
    return (
        <div role="status" className="min-h-[60vh] flex items-center justify-center">
            <div
                aria-hidden="true"
                className="delayed-show w-8 h-8 rounded-full border-2 border-accent/20 border-t-accent animate-spin"
            />
            <span className="sr-only">Loading page</span>
        </div>
    );
}
