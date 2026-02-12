import { Link } from 'react-router-dom';
import { Home, AlertCircle } from 'lucide-react';
import SEO from '../components/SEO';

export default function NotFound() {
    return (
        <>
            <SEO page="notFound" />
            <div className="min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
            <div className="bg-dark-100 p-8 md:p-12 rounded-2xl border border-gray-800 shadow-xl max-w-lg w-full relative overflow-hidden">
                {/* Background Decoration */}
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-accent to-purple-500" />

                <div className="mb-8 relative">
                    <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full" />
                    <AlertCircle className="w-24 h-24 text-accent relative z-10 mx-auto" strokeWidth={1.5} />
                </div>

                <h1 className="text-6xl font-black text-white mb-2 tracking-tight">404</h1>
                <h2 className="text-2xl font-bold text-gray-200 mb-4">Page Not Found</h2>

                <p className="text-gray-400 mb-8 leading-relaxed">
                    Oops! The page you're looking for seems to have vanished into the void.
                    It might have been moved, deleted, or never existed.
                </p>

                <Link
                    to="/"
                    className="btn-primary inline-flex items-center gap-2 px-8 py-3"
                >
                    <Home className="w-5 h-5" />
                    Back to Home
                </Link>
            </div>
        </div>
        </>
    );
}
