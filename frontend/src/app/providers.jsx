import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter } from 'react-router-dom';

import ErrorBoundary from '../components/ErrorBoundary';
import ScrollToTop from '../components/ScrollToTop';
import UmamiAnalytics from '../components/UmamiAnalytics';
import { AuthProvider } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5,
            gcTime: 1000 * 60 * 30,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

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
                                <Toaster
                                    position="bottom-right"
                                    toastOptions={{
                                        style: {
                                            background: 'var(--color-dark-100)',
                                            color: '#fff',
                                            border: '1px solid var(--color-border)',
                                        },
                                        success: {
                                            iconTheme: {
                                                primary: '#10b981',
                                                secondary: '#fff',
                                            },
                                        },
                                        error: {
                                            iconTheme: {
                                                primary: '#ef4444',
                                                secondary: '#fff',
                                            },
                                        },
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
