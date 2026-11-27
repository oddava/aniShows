import { Outlet, useLocation } from 'react-router-dom';
import React, { Suspense, useEffect, useRef } from 'react';
import Navbar from './Navbar';
import Footer from './Footer';
import VerificationBanner from './VerificationBanner';
import AnnouncementBanner from './AnnouncementBanner';
import PageLoader from './common/PageLoader';
import RouteProgress from './common/RouteProgress';
import DataPrefetch from './common/DataPrefetch';

// Pages are keyed by their first two path segments, so a route change fades the
// new page in, while sub-paths of one page (anime tabs, profile tabs) and query
// string changes (browse filters) do not remount it.
const getPageKey = (pathname) => pathname.split('/').filter(Boolean).slice(0, 2).join('/') || 'home';

export default function Layout() {
    const location = useLocation();
    const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
    const isBrowsePage = normalizedPath === '/browse';
    const isFlushPage = normalizedPath === '/' || normalizedPath.startsWith('/profile') || normalizedPath.startsWith('/u/') || normalizedPath.startsWith('/anime/');
    const pageKey = getPageKey(normalizedPath);

    // The first page of a visit skips its entry fades (html[data-boot], set by
    // public/boot.js, for LCP); from the first in-app navigation on, pages fade in.
    const firstPageKey = useRef(pageKey);
    useEffect(() => {
        if (pageKey !== firstPageKey.current) document.documentElement.removeAttribute('data-boot');
    }, [pageKey]);

    return (
        <div className="min-h-screen bg-dark flex flex-col">
            <a href="#main-content" className="skip-link">Skip to content</a>
            <RouteProgress />
            <DataPrefetch />
            <Suspense fallback={null}>
                <Navbar />
            </Suspense>
            {!isFlushPage && <div aria-hidden="true" className="h-14 md:h-16 shrink-0" />}
            <VerificationBanner />
            {/* Flush pages start under the fixed navbar, so the banner clears it. */}
            <AnnouncementBanner className={isFlushPage ? 'mt-14 md:mt-16' : ''} />
            <main
                id="main-content"
                tabIndex={-1}
                className={`${isBrowsePage ? '' : 'flex-grow'} md:pb-0 focus:outline-none`}
            >
                {/* The boundary sits outside the keyed wrapper so it persists:
                    router navigations run as transitions, so the current page
                    stays up until the next one's chunk has loaded. */}
                <Suspense fallback={<PageLoader />}>
                    <div key={pageKey} className="page-enter">
                        <Outlet />
                    </div>
                </Suspense>
            </main>
            <Footer className={isBrowsePage ? '' : 'mt-auto'} />
        </div>
    );
}
