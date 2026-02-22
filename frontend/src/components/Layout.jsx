import { Outlet } from 'react-router-dom';
import React, { Suspense } from 'react';
import Navbar from './Navbar';
import Footer from './Footer';

const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

export default function Layout() {
    return (
        <div className="min-h-screen bg-dark flex flex-col">
            <Suspense fallback={<PageLoader />}>
                <Navbar />
            </Suspense>
            <main className="pt-16 flex-grow">
                <Outlet />
            </main>
            <Footer />
        </div>
    );
}
