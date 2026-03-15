import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User, Lock, Mail, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import GoogleLoginButton from '../components/GoogleLoginButton';
import SEO from '../components/SEO';
import logger from '../utils/logger';

export function Login() {
    const [formData, setFormData] = useState({
        username: '', // Changed from email to username
        password: '',
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, isAuthenticated, user } = useAuth();
    const navigate = useNavigate();

    // Redirect if already authenticated
    useEffect(() => {
        if (isAuthenticated) {
            const isAdminUser = Boolean(user?.is_staff || user?.is_superuser);
            navigate(isAdminUser ? '/admin' : '/browse');
        }
    }, [isAuthenticated, navigate, user?.is_staff, user?.is_superuser]);

    // Show loading spinner during redirect
    if (isAuthenticated) {
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
        );
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const loggedInUser = await login(formData.username.trim(), formData.password.trim());
            const isAdminUser = Boolean(loggedInUser?.is_staff || loggedInUser?.is_superuser);
            navigate(isAdminUser ? '/admin' : '/browse');
        } catch (err) {
            logger.error('Login error:', err);
            let msg = 'Invalid username or password';
            if (err.response?.data) {
                const data = err.response.data;
                if (data.detail) {
                    msg = data.detail;
                } else if (data.non_field_errors) {
                    msg = Array.isArray(data.non_field_errors) ? data.non_field_errors[0] : data.non_field_errors;
                } else {
                    // Check if we have field specific errors that we can't show inline easily
                    // Login form usually doesn't show inline field errors for username/password unless we add them
                    // For now, let's grab the first error we find
                    const firstKey = Object.keys(data)[0];
                    if (firstKey && Array.isArray(data[firstKey])) {
                        msg = `${firstKey}: ${data[firstKey][0]}`;
                    }
                }
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <SEO page="login" />
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                        <p className="text-gray-400">Sign in to continue your anime journey</p>
                    </div>

                    <div className="bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl">
                    {error && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle className="w-5 h-5 shrink-0" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    <div className="mb-6">
                        <GoogleLoginButton />
                        <div className="relative mt-6">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-gray-800" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-dark-100 text-gray-400">Or continue with</span>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Username or Email
                            </label>
                            <div className="relative group">
                                <User className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="text"
                                    required
                                    className="input !pl-12 w-full"
                                    placeholder="Enter your username or email"
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-gray-300">
                                    Password
                                </label>
                            </div>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="password"
                                    required
                                    className="input !pl-12 w-full"
                                    placeholder="Enter your password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                            <div className="flex justify-end mt-2">
                                <Link to="/forgot-password" className="text-xs text-accent hover:text-accent-hover transition-colors">
                                    Forgot Password?
                                </Link>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    Sign In <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-gray-400">
                        Don't have an account?{' '}
                        <Link to="/register" className="text-accent hover:text-accent-hover font-medium transition-colors">
                            Sign up
                        </Link>
                    </div>
                </div>
            </div>
        </div>
        </>
    );
}

export function Register() {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
    });
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const { register, login, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    // Redirect if already authenticated
    useEffect(() => {
        if (isAuthenticated) {
            navigate('/browse');
        }
    }, [isAuthenticated, navigate]);

    // Show loading spinner during redirect
    if (isAuthenticated) {
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
        );
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrors({});

        if (formData.password !== formData.confirmPassword) {
            setErrors({ password: ['Passwords do not match'] });
            return;
        }

        setLoading(true);

        try {
            // Register
            await register(formData.username, formData.email, formData.password);

            // Redirect to verification pending page
            navigate('/verification-pending', {
                state: {
                    email: formData.email,
                    message: "Please check your email to verify your account. Unverified accounts are automatically deleted after 7 days."
                }
            });

        } catch (err) {
            // Handle field errors from DRF
            if (err.response?.data) {
                const data = err.response.data;
                const newErrors = { ...data };

                // Map non_field_errors to general
                if (data.non_field_errors) {
                    newErrors.general = Array.isArray(data.non_field_errors)
                        ? data.non_field_errors[0]
                        : data.non_field_errors;
                }

                // Map detail to general
                if (data.detail) {
                    newErrors.general = data.detail;
                }

                setErrors(newErrors);
            } else {
                setErrors({ general: 'Registration failed. Please try again.' });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <SEO page="register" />
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
                        <p className="text-gray-400">Join the community and track your anime</p>
                    </div>

                    <div className="bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl">
                    {errors.general && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle className="w-5 h-5 shrink-0" />
                            <p className="text-sm">{errors.general}</p>
                        </div>
                    )}

                    <div className="mb-6">
                        <GoogleLoginButton />
                        <div className="relative mt-6">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-gray-800" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-dark-100 text-gray-400">Or register with email</span>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Username
                            </label>
                            <div className="relative group">
                                <User className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="text"
                                    required
                                    className={`input !pl-12 w-full ${errors.username ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
                                    placeholder="Choose a username"
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                />
                            </div>
                            {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="email"
                                    required
                                    className={`input !pl-12 w-full ${errors.email ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
                                    placeholder="Enter your email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Password
                            </label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="password"
                                    required
                                    className={`input !pl-12 w-full ${errors.password ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
                                    placeholder="Create a password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Confirm Password
                            </label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="password"
                                    required
                                    className="input !pl-12 w-full"
                                    placeholder="Confirm your password"
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    Create Account <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-gray-400">
                        Already have an account?{' '}
                        <Link to="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
                            Sign in
                        </Link>
                    </div>
                </div>
            </div>
        </div>
        </>
    );
}
