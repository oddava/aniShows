import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User, Lock, Mail, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

export function Login() {
    const [formData, setFormData] = useState({
        username: '', // Changed from email to username
        password: '',
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    // Redirect if already authenticated
    if (isAuthenticated) {
        navigate('/browse');
        return null; // Prevent rendering login form
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(formData.username.trim(), formData.password.trim());
            navigate('/browse');
        } catch (err) {
            // Check for specific error message from backend
            const msg = err.response?.data?.detail || 'Invalid username or password';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
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
                                {/* Forgot Password Disabled
                                <Link to="/forgot-password" class="text-xs text-accent hover:text-accent-hover transition-colors">
                                    Forgot Password?
                                </Link>
                                */}
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
    const { register, login, isAuthenticated } = useAuth(); // Import login to auto-login
    const navigate = useNavigate();

    // Redirect if already authenticated
    if (isAuthenticated) {
        navigate('/browse');
        return null;
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

            // Auto Login
            await login(formData.username, formData.password);
            navigate('/browse');

        } catch (err) {
            // Handle field errors from DRF
            if (err.response?.data) {
                setErrors(err.response.data);
            } else {
                setErrors({ general: 'Registration failed. Please try again.' });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
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
    );
}
