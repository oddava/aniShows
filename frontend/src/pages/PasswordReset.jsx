import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { Mail, ArrowRight, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function PasswordReset() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [message, setMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setMessage('');

        try {
            await authApi.resetPassword({ email });
            setStatus('success');
            setMessage('If an account exists with this email, a reset link has been sent.');
        } catch (err) {
            setStatus('error');
            setMessage(err.response?.data?.error || 'Failed to send reset link');
        }
    };

    if (status === 'success') {
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl text-center">
                    <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-8 h-8 text-green-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-4">Check your email</h2>
                    <p className="text-gray-400 mb-8">{message}</p>
                    <Link to="/login" className="btn-primary w-full block">
                        Return to Login
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">Reset Password</h1>
                    <p className="text-gray-400">Enter your email to receive a reset link</p>
                </div>

                <div className="bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl">
                    {status === 'error' && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle className="w-5 h-5 shrink-0" />
                            <p className="text-sm">{message}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                                <input
                                    type="email"
                                    required
                                    className="input !pl-12 w-full"
                                    placeholder="Enter your email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={status === 'loading'}
                            className="btn-primary w-full flex items-center justify-center gap-2"
                        >
                            {status === 'loading' ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    Send Reset Link <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-gray-400">
                        Remember your password?{' '}
                        <Link to="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
                            Sign in
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
