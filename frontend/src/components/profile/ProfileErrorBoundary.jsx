import { Component } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import { captureException } from '../../sentry';

const ErrorVariant = {
    FULL_PAGE: 'full_page',
    SECTION: 'section',
    CARD: 'card',
};

export default class ProfileErrorBoundary extends Component {
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        captureException(error, {
            tags: {
                component: 'ProfileErrorBoundary',
                section: this.props.section || 'unknown',
            },
            extra: {
                componentStack: errorInfo.componentStack,
                props: {
                    username: this.props.username,
                },
            },
        });
    }

    state = { hasError: false, error: null };

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
        if (this.props.onRetry) {
            this.props.onRetry();
        }
    };

    render() {
        const { hasError, error } = this.state;
        const {
            children,
            variant = ErrorVariant.FULL_PAGE,
            section = 'Profile',
            fallback: CustomFallback,
        } = this.props;

        if (hasError) {
            if (CustomFallback) {
                return <CustomFallback error={error} onRetry={this.handleRetry} />;
            }

            switch (variant) {
                case ErrorVariant.CARD:
                    return <CardErrorFallback section={section} onRetry={this.handleRetry} />;
                case ErrorVariant.SECTION:
                    return <SectionErrorFallback section={section} onRetry={this.handleRetry} />;
                case ErrorVariant.FULL_PAGE:
                default:
                    return <FullPageErrorFallback error={error} onRetry={this.handleRetry} />;
            }
        }

        return children;
    }
}

function FullPageErrorFallback({ error, onRetry }) {
    return (
        <div className="min-h-screen flex items-center justify-center px-4">
            <div className="max-w-md w-full text-center">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                    <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                    Something went wrong
                </h1>
                <p className="text-gray-400 mb-6">
                    We encountered an unexpected error while loading this profile.
                    Our team has been notified and is working on a fix.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={onRetry}
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-accent text-white rounded-xl font-medium hover:bg-accent/80 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                    <Link
                        to="/"
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-dark-100 text-white rounded-xl font-medium hover:bg-dark-50 transition-colors border border-gray-800"
                    >
                        <Home className="w-4 h-4" />
                        Go Home
                    </Link>
                </div>
                {import.meta.env.DEV && error && (
                    <details className="mt-6 text-left">
                        <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-400">
                            Error Details (Dev Only)
                        </summary>
                        <pre className="mt-2 p-4 bg-dark-100 rounded-lg text-xs text-red-400 overflow-auto max-h-40">
                            {error.message}
                            {'\n\n'}
                            {error.stack}
                        </pre>
                    </details>
                )}
            </div>
        </div>
    );
}

function SectionErrorFallback({ section, onRetry }) {
    return (
        <div className="bg-dark-100/50 rounded-xl border border-red-500/20 p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-white mb-2">
                Failed to load {section}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
                Something went wrong. Please try again.
            </p>
            <button
                onClick={onRetry}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent/20 text-accent rounded-lg text-sm font-medium hover:bg-accent/30 transition-colors"
            >
                <RefreshCw className="w-4 h-4" />
                Retry
            </button>
        </div>
    );
}

function CardErrorFallback({ section, onRetry }) {
    return (
        <div className="bg-dark-100 rounded-lg border border-red-500/20 p-4 text-center">
            <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-gray-400 mb-2">Error loading {section}</p>
            <button
                onClick={onRetry}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
            >
                Retry
            </button>
        </div>
    );
}

export { ErrorVariant };
export { FullPageErrorFallback as ProfileErrorFallback };
export { SectionErrorFallback };
export { CardErrorFallback };
