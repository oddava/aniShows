import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Search, Menu, X, User, Heart, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { user, logout, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    // Hide search on browse and anime detail pages (they have their own search/filters)
    const hideSearch = location.pathname.startsWith('/browse') || location.pathname.startsWith('/anime/');

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/browse?q=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
        }
    };

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-dark/80 backdrop-blur-xl border-b border-gray-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-white">AniShows</span>
                    </Link>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center gap-8">
                        <Link to="/browse" className="text-gray-300 hover:text-white transition-colors font-medium">
                            Browse
                        </Link>

                        {/* Search - animated visibility */}
                        <form
                            onSubmit={handleSearch}
                            className={`relative transition-all duration-300 ease-in-out ${hideSearch
                                    ? 'w-0 opacity-0 overflow-hidden pointer-events-none'
                                    : 'w-64 opacity-100'
                                }`}
                        >
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search anime..."
                                className="w-full pl-10 pr-4 py-2 bg-dark-100 border border-gray-700 rounded-xl text-sm
                         placeholder:text-gray-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                            />
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        </form>
                    </div>

                    {/* Auth Section */}
                    <div className="hidden md:flex items-center gap-4">
                        {isAuthenticated ? (
                            <>
                                <Link to="/profile" className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
                                    <Heart className="w-5 h-5" />
                                </Link>
                                <Link to="/profile" className="flex items-center gap-2 px-4 py-2 bg-dark-100 rounded-xl
                                                text-gray-300 hover:text-white transition-colors">
                                    <User className="w-4 h-4" />
                                    <span className="text-sm font-medium">{user?.username}</span>
                                </Link>
                                <button onClick={logout} className="text-gray-400 hover:text-white transition-colors">
                                    <LogOut className="w-5 h-5" />
                                </button>
                            </>
                        ) : (
                            <>
                                <Link to="/login" className="text-gray-300 hover:text-white transition-colors font-medium">
                                    Sign In
                                </Link>
                                <Link to="/register" className="btn-primary text-sm py-2">
                                    Get Started
                                </Link>
                            </>
                        )}
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="md:hidden p-2 text-gray-400 hover:text-white"
                    >
                        {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {isMenuOpen && (
                <div className="md:hidden bg-dark-100 border-t border-gray-800">
                    <div className="px-4 py-4 space-y-4">
                        <form onSubmit={handleSearch}>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search anime..."
                                className="input text-sm"
                            />
                        </form>

                        <Link to="/browse" className="block py-2 text-gray-300 hover:text-white" onClick={() => setIsMenuOpen(false)}>
                            Browse
                        </Link>

                        {isAuthenticated ? (
                            <>
                                <Link to="/profile" className="block py-2 text-gray-300 hover:text-white" onClick={() => setIsMenuOpen(false)}>
                                    Profile
                                </Link>
                                <button onClick={() => { logout(); setIsMenuOpen(false); }} className="block py-2 text-gray-400 hover:text-white">
                                    Sign Out
                                </button>
                            </>
                        ) : (
                            <>
                                <Link to="/login" className="block py-2 text-gray-300 hover:text-white" onClick={() => setIsMenuOpen(false)}>
                                    Sign In
                                </Link>
                                <Link to="/register" className="block py-2 text-accent hover:text-accent-light" onClick={() => setIsMenuOpen(false)}>
                                    Get Started
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
}
