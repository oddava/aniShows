import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Search, Menu, X, User, LogOut, ChevronDown, AlertCircle, RefreshCw, CheckCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { user, logout, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const profileRef = useRef(null);

    // Hide search on browse and anime detail pages (they have their own search/filters)
    const hideSearch = location.pathname.startsWith('/browse') || location.pathname.startsWith('/anime/');

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/browse?q=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
        }
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
            <nav className={`fixed top-0 left-0 right-0 z-50 bg-dark/80 backdrop-blur-xl border-b border-gray-800 ${showVerificationBanner ? 'top-[40px]' : 'top-0'} transition-[top]`}>
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
                                    {/* Mobile Profile Header */}
                                    <div className="flex items-center gap-3 py-2 border-t border-gray-700/50 pt-4">
                                        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-accent/30">
                                            {user?.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                                    <User className="w-5 h-5 text-white" />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-white">{user?.username}</p>
                                            <p className="text-xs text-gray-400">{user?.email}</p>
                                        </div>
                                    </div>
                                    <Link to="/profile" className="block py-2 text-gray-300 hover:text-white" onClick={() => setIsMenuOpen(false)}>
                                        Profile
                                    </Link>
                                    <Link to="/settings" className="block py-2 text-gray-300 hover:text-white" onClick={() => setIsMenuOpen(false)}>
                                        Settings
                                    </Link>
                                    <button onClick={() => { logout(); setIsMenuOpen(false); }} className="block py-2 text-gray-400 hover:text-red-400">
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
        </>
    );
}

