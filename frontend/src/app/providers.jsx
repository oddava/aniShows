import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter } from 'react-router-dom';

import ErrorBoundary from '../components/ErrorBoundary';
import ScrollToTop from '../components/ScrollToTop';
import UmamiAnalytics from '../components/UmamiAnalytics';
import { AuthProvider } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import queryClient from './queryClient';

export default function AppProviders({ children }) {
    return (
        <HelmetProvider>
            <QueryClientProvider client={queryClient}>
                <ErrorBoundary>
                    <ThemeProvider>
                        <AuthProvider>
                            <BrowserRouter>
                                <ScrollToTop />
                                <UmamiAnalytics />
                                {children}
                                {/* One toast style site-wide (components/ui/toast.jsx);
                                    bottom-centre, above the phone tab bar. */}
                                <Toaster
                                    position="bottom-center"
                                    containerClassName="toast-container"
                                    gutter={8}
                                    toastOptions={{
                                        duration: 5000,
                                        style: {
                                            background: 'var(--ink-3)',
                                            color: '#f1f3f5',
                                            borderRadius: '10px',
                                            fontSize: '14px',
                                            boxShadow: 'var(--shadow-pop)',
                                        },
                                        success: { iconTheme: { primary: '#86cc90', secondary: '#15181d' } },
                                        error: { iconTheme: { primary: '#f2878f', secondary: '#15181d' } },
                                    }}
                                />
                            </BrowserRouter>
                        </AuthProvider>
                    </ThemeProvider>
                </ErrorBoundary>
            </QueryClientProvider>
        </HelmetProvider>
    );
}
