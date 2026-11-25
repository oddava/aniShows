import { Outlet, useLocation } from 'react-router-dom';
import React, { Suspense } from 'react';
import Navbar from './Navbar';
import Footer from './Footer';
import VerificationBanner from './VerificationBanner';
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
            <main
                id="main-content"
                tabIndex={-1}
                className={`${isBrowsePage ? '' : 'flex-grow'} md:pb-0 focus:outline-none`}
            >
                {/* The boundary sits outside the keyed wrapper so it persists:
                    router navigations run as transitions, so the current page
                    stays up until the next one's chunk has loaded. */}
                <Suspense fallback={<PageLoader />}>
                    <div key={getPageKey(normalizedPath)} className="page-enter">
                        <Outlet />
                    </div>
                </Suspense>
            </main>
            <Footer className={isBrowsePage ? '' : 'mt-auto'} />
        </div>
    );
}
