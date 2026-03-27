import { Outlet, useLocation } from 'react-router-dom';
import React, { Suspense } from 'react';
import Navbar from './Navbar';
import Footer from './Footer';
import VerificationBanner from './VerificationBanner';

const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

export default function Layout() {
    const location = useLocation();
    const isBrowsePage = location.pathname === '/browse';

    return (
        <div className="min-h-screen bg-dark flex flex-col">
            <Suspense fallback={<PageLoader />}>
                <Navbar />
            </Suspense>
            <div className="hidden md:block h-16" /> {/* Spacer for fixed desktop navbar */}
            <VerificationBanner />
            <main className={`${isBrowsePage ? '' : 'flex-grow'} pb-24 md:pb-0`}>
                <Outlet />
            </main>
            <Footer className={isBrowsePage ? '' : 'mt-auto'} />
        </div>
    );
}
