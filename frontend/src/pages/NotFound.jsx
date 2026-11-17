import { Link } from 'react-router-dom';
import SEO from '../components/SEO';

export default function NotFound() {
    return (
        <>
            <SEO page="notFound" noIndex />
            <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
                <div className="ui-empty-state w-full max-w-lg">
                    <p className="section-title mb-3">404</p>
                    <h1 className="text-lg font-semibold text-white mb-2">Page not found</h1>
                    <p className="text-sm text-gray-400 mb-6">
                        This link may be outdated, or the page has moved.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Link to="/browse" className="btn-primary text-sm">Browse Anime</Link>
                        <Link to="/" className="btn-secondary text-sm">Go Home</Link>
                    </div>
                </div>
            </div>
        </>
    );
}
