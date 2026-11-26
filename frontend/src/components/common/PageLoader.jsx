import React, { useEffect } from 'react';

// While any page loader is up the footer is not laid out at all (index.css):
// it then appears under the finished page instead of sliding up from below
// the loader on a short page.
let shown = 0;

/**
 * Route-level fallback while a page chunk loads. It is a full viewport tall,
 * so the footer starts below the fold and does not jump when the page lands,
 * and it stays invisible for the first 300 ms, so quick navigations never
 * flash a spinner. The fade sits on a wrapper because `.delayed-show` and
 * `animate-spin` both set `animation`.
 */
export default function PageLoader() {
    useEffect(() => {
        shown += 1;
        document.documentElement.dataset.pageLoading = 'true';
        return () => {
            shown -= 1;
            if (shown === 0) delete document.documentElement.dataset.pageLoading;
        };
    }, []);

    return (
        <div role="status" className="min-h-[100dvh] flex items-center justify-center">
            <div aria-hidden="true" className="delayed-show">
                <div className="w-8 h-8 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
            </div>
            <span className="sr-only">Loading page</span>
        </div>
    );
}
