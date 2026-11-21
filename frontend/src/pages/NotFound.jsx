import { Link } from 'react-router-dom';
import SEO from '../components/SEO';

export default function NotFound() {
    return (
        <>
            <SEO page="notFound" noIndex />
            <div className="page-container pt-6 pb-24 md:pt-10">
                <h1 className="page-title">Page not found</h1>
                <p className="mt-1 text-sm text-[var(--text-2)]">
                    This link may be out of date, or the page has moved.
                </p>
                <div className="mt-8 flex flex-wrap gap-2">
                    <Link to="/browse" className="btn-primary text-sm">Browse anime</Link>
                    <Link to="/" className="btn-ghost text-sm">Go home</Link>
                </div>
            </div>
        </>
    );
}
