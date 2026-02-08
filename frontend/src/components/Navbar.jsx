import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Search, Menu, X, User, LogOut, ChevronDown, AlertCircle, RefreshCw, CheckCircle, Star, Loader2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authApi, animeApi } from '../api/client';

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchSuggestions, setSearchSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const { user, logout, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const profileRef = useRef(null);
    const searchRef = useRef(null);

    // Hide search on browse and anime detail pages (they have their own search/filters)
    const hideSearch = location.pathname.startsWith('/browse') || location.pathname.startsWith('/anime/');

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setIsProfileOpen(false);
            }
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Debounced search suggestions
    useEffect(() => {
        if (searchQuery.trim().length < 2) {
            setSearchSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const timeout = setTimeout(async () => {
            setIsSearching(true);
            try {
                const response = await animeApi.getAll({ q: searchQuery.trim(), page_size: 5 });
                setSearchSuggestions(response.data.results || []);
                setShowSuggestions(true);
            } catch (error) {
                console.error('Search error:', error);
                setSearchSuggestions([]);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [searchQuery]);

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/browse?q=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
            setShowSuggestions(false);
        }
    };

    const handleSuggestionClick = (slug) => {
        navigate(`/anime/${slug}`);
        setSearchQuery('');
        setShowSuggestions(false);
    };

    const [isResending, setIsResending] = useState(false);
    const [resendSuccess, setResendSuccess] = useState(false);

    const handleResendVerification = async () => {
        if (!user?.email) return;
        setIsResending(true);
        try {
            await authApi.resendVerification({ email: user.email });
            setResendSuccess(true);
            setTimeout(() => setResendSuccess(false), 5000);
        } catch (err) {
            console.error('Failed to resend verification:', err);
        } finally {
            setIsResending(false);
        }
    };

    const showVerificationBanner = isAuthenticated && user && user.email_verified === false;

    return (
        <>
            {showVerificationBanner && (
                <div className="bg-yellow-500/10 border-b border-yellow-500/20 backdrop-blur-sm relative z-[60]">
                    <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4 text-sm">
                        <div className="flex items-center gap-2 text-yellow-500">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>
                                Please verify your email address to access all features.
                                <span className="hidden sm:inline"> Check your inbox for the verification link.</span>
                            </span>
                        </div>
                        {resendSuccess ? (
                            <div className="flex items-center gap-2 text-green-400 font-medium whitespace-nowrap">
                                <CheckCircle className="w-4 h-4" />
                                <span>Sent!</span>
                            </div>
                        ) : (
                            <button
                                onClick={handleResendVerification}
                                disabled={isResending}
                                className="flex items-center gap-2 text-yellow-500 hover:text-yellow-400 font-medium whitespace-nowrap disabled:opacity-50 transition-colors"
                            >
                                {isResending ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="w-4 h-4" />
                                )}
                                Resend Email
                            </button>
                        )}
                    </div>
                </div>
            )}
            <nav className={`fixed top-0 left-0 right-0 z-[1000] bg-dark/80 backdrop-blur-xl border-b border-gray-800 ${showVerificationBanner ? 'top-[40px]' : 'top-0'} transition-[top]`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}

                        <Link to="/" className="flex items-center gap-2 sm:gap-3 group">
                            <span className="text-xl sm:text-2xl font-bold text-white">
                                AniShows
                            </span>
                        </Link>

                        {/* Desktop Nav */}
                        <div className="hidden md:flex items-center gap-8 flex-1 ml-8">
                            <Link to="/browse" className="text-gray-300 hover:text-white transition-colors font-medium shrink-0">
                                Browse
                            </Link>
                            <Link to="/seasonal" className="text-gray-300 hover:text-white transition-colors font-medium shrink-0">
                                Seasonal
                            </Link>

                            {/* Search - prominent and centered */}
                            <div className="flex-1 flex justify-center max-w-2xl mx-auto" ref={searchRef}>
                                <div
                                    className={`relative transition-all duration-300 ease-in-out w-full max-w-lg ${hideSearch
                                        ? 'opacity-0 overflow-hidden pointer-events-none'
                                        : 'opacity-100'
                                        }`}
                                >
                                    <form onSubmit={handleSearch}>
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onFocus={() => searchSuggestions.length > 0 && setShowSuggestions(true)}
                                            placeholder="Search anime..."
                                            className="w-full pl-11 pr-4 py-2.5 bg-dark-100 border border-gray-700/50 rounded-xl text-sm text-white
                                         placeholder:text-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all shadow-sm"
                                        />
                                        {isSearching ? (
                                            <Loader2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-accent animate-spin" />
                                        ) : (
                                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        )}
                                    </form>

                                    {/* Search Suggestions Dropdown */}
                                    {showSuggestions && searchSuggestions.length > 0 && (
                                        <div className="fixed sm:absolute left-2 right-2 sm:left-0 sm:right-0 top-full mt-2 bg-dark-100 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
                                            {searchSuggestions.map((anime) => (
                                                <button
                                                    key={anime.id}
                                                    onClick={() => handleSuggestionClick(anime.slug)}
                                                    className="w-full flex items-center gap-2 sm:gap-3 p-2 sm:p-3 hover:bg-dark-50 transition-colors text-left"
                                                >
                                                    <img
                                                        src={anime.cover_image}
                                                        alt={anime.title}
                                                        className="w-8 h-12 sm:w-10 sm:h-14 object-cover rounded-lg flex-shrink-0"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="text-sm font-semibold text-white line-clamp-1">{anime.title}</h4>
                                                        <div className="flex items-center gap-1 sm:gap-2 text-xs text-gray-400 mt-0.5">
                                                            <span>{anime.anime_type}</span>
                                                            {anime.episode_count && (
                                                                <>
                                                                    <span className="hidden sm:inline">•</span>
                                                                    <span className="hidden sm:inline">{anime.episode_count} eps</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {anime.rating && (
                                                        <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-yellow-500/10 rounded-lg flex-shrink-0">
                                                            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                                                            <span className="text-xs font-bold text-yellow-500">{anime.rating}</span>
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                            <button
                                                onClick={handleSearch}
                                                className="w-full py-2 sm:py-3 text-center text-sm font-medium text-accent hover:bg-dark-50 transition-colors border-t border-gray-700"
                                            >
                                                View all results
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Auth Section */}
                        <div className="hidden md:flex items-center gap-4">
                            {isAuthenticated ? (
                                <div className="relative" ref={profileRef}>
                                    {/* Profile Button */}
                                    <button
                                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                                        className="flex items-center gap-3 px-3 py-1.5 bg-dark-100 hover:bg-dark-50 rounded-full
                                               border border-gray-700/50 hover:border-accent/50 transition-all duration-200 group"
                                    >
                                        {/* Avatar */}
                                        <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-transparent group-hover:border-accent/50 transition-colors">
                                            {user?.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                                    <User className="w-4 h-4 text-white" />
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
                                            {user?.username}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {/* Dropdown Menu */}
                                    {isProfileOpen && (
                                        <div className="absolute right-0 top-full mt-2 w-56 py-2 bg-dark-100/95 backdrop-blur-xl 
                                                    rounded-xl border border-gray-700/50 shadow-xl shadow-black/20 animate-fade-in">
                                            {/* User Info Header */}
                                            <div className="px-4 py-3 border-b border-gray-700/50">
                                                <p className="text-sm font-semibold text-white truncate">{user?.username}</p>
                                                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                                            </div>

                                            {/* Menu Items */}
                                            <div className="py-1">
                                                <Link
                                                    to="/profile"
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white 
                                                           hover:bg-accent/10 transition-colors"
                                                >
                                                    <User className="w-4 h-4" />
                                                    <span className="text-sm font-medium">Profile</span>
                                                </Link>
                                                <Link
                                                    to="/settings"
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white 
                                                           hover:bg-accent/10 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    </svg>
                                                    <span className="text-sm font-medium">Settings</span>
                                                </Link>
                                                <button
                                                    onClick={() => { logout(); setIsProfileOpen(false); }}
                                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-red-400 
                                                           hover:bg-red-500/10 transition-colors"
                                                >
                                                    <LogOut className="w-4 h-4" />
                                                    <span className="text-sm font-medium">Sign Out</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
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
                    <div className="md:hidden bg-dark-100 border-t border-gray-800 max-h-[calc(100vh-4rem)] overflow-y-auto">
                        <div className="px-4 py-4 space-y-4">
                            <form onSubmit={handleSearch}>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search anime..."
                                    className="input text-sm w-full"
                                />
                            </form>

                            <div className="space-y-1">
                                <Link to="/browse" className="flex items-center gap-3 py-3 px-2 text-gray-300 hover:text-white hover:bg-dark-50 rounded-lg transition-colors" onClick={() => setIsMenuOpen(false)}>
                                    <Search className="w-5 h-5" />
                                    Browse
                                </Link>
                                <Link to="/seasonal" className="flex items-center gap-3 py-3 px-2 text-gray-300 hover:text-white hover:bg-dark-50 rounded-lg transition-colors" onClick={() => setIsMenuOpen(false)}>
                                    <RefreshCw className="w-5 h-5" />
                                    Seasonal
                                </Link>
                            </div>

                            {isAuthenticated ? (
                                <div className="space-y-1 pt-4 border-t border-gray-700/50">
                                    {/* Mobile Profile Header */}
                                    <Link to="/profile" className="flex items-center gap-3 py-3 px-2 hover:bg-dark-50 rounded-lg transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-accent/30 shrink-0">
                                            {user?.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                                    <User className="w-5 h-5 text-white" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white">{user?.username}</p>
                                            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                                        </div>
                                    </Link>
                                    <Link to="/settings" className="flex items-center gap-3 py-3 px-2 text-gray-300 hover:text-white hover:bg-dark-50 rounded-lg transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        Settings
                                    </Link>
                                    <button onClick={() => { logout(); setIsMenuOpen(false); }} className="w-full flex items-center gap-3 py-3 px-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                        <LogOut className="w-5 h-5" />
                                        Sign Out
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-1 pt-4 border-t border-gray-700/50">
                                    <Link to="/login" className="flex items-center gap-3 py-3 px-2 text-gray-300 hover:text-white hover:bg-dark-50 rounded-lg transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        <LogOut className="w-5 h-5 rotate-180" />
                                        Sign In
                                    </Link>
                                    <Link to="/register" className="flex items-center justify-center gap-2 py-3 px-2 bg-accent text-dark font-semibold rounded-lg hover:bg-accent/90 transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        Get Started
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </nav>
        </>
    );
}

