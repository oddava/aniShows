import React from 'react';

/**
 * Route-level fallback while a page chunk loads. It is a full viewport tall,
 * so the footer starts below the fold and does not jump when the page lands,
 * and it stays invisible for the first 300 ms, so quick navigations never
 * flash a spinner. The fade sits on a wrapper because `.delayed-show` and
 * `animate-spin` both set `animation`.
 */
export default function PageLoader() {
    return (
        <div role="status" className="min-h-[100dvh] flex items-center justify-center">
            <div aria-hidden="true" className="delayed-show">
                <div className="w-8 h-8 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
            </div>
            <span className="sr-only">Loading page</span>
        </div>
    );
}
