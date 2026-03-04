import React from 'react';
import logger from '../utils/logger';
import { captureException } from '../sentry';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        logger.error('ErrorBoundary caught an error:', error, errorInfo);
        captureException(error, {
            tags: { component: 'GlobalErrorBoundary' },
            extra: { componentStack: errorInfo.componentStack },
        });
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-dark-200 text-white p-4">
                    <div className="bg-dark-100 p-8 rounded-2xl border border-gray-800 text-center max-w-md w-full shadow-2xl">
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
                        <p className="text-gray-400 mb-6 text-sm">
                            We're sorry, but an unexpected error occurred. Please try reloading the page.
                        </p>
                        <button
                            onClick={this.handleReload}
                            className="bg-accent hover:bg-accent-light text-white px-6 py-3 rounded-xl font-medium transition-colors w-full"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
