import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import { Mail, CheckCircle, Loader2, RefreshCw } from 'lucide-react';

export default function VerificationPending() {
    const [searchParams] = useSearchParams();
    const email = searchParams.get('email') || '';
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [resendEmail, setResendEmail] = useState(email);

    const handleResend = async (e) => {
        e.preventDefault();
        if (!resendEmail) return;

        setLoading(true);
        setMessage('');

        try {
            await authApi.resendVerification({ email: resendEmail });
            setMessage('If an account exists with this email and is pending verification, a new link has been sent.');
        } catch (err) {
            setMessage('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl text-center">
                <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Mail className="w-8 h-8 text-accent" />
                </div>

                <h2 className="text-2xl font-bold text-white mb-2">Check Your Email</h2>
                <p className="text-gray-400 mb-8">
                    We've sent a verification link to your email address.
                    Please click the link to activate your account.
                </p>

                <div className="bg-dark-200 rounded-xl p-4 mb-6">
                    <p className="text-sm text-gray-400 mb-1">Didn't receive the email?</p>
                    <p className="text-xs text-gray-500">Check your spam folder or request a new link below.</p>
                </div>

                <form onSubmit={handleResend} className="space-y-4">
                    <div className="relative group">
                        <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
                        <input
                            type="email"
                            required
                            className="input !pl-12 w-full"
                            placeholder="Enter your email"
                            value={resendEmail}
                            onChange={(e) => setResendEmail(e.target.value)}
                        />
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
                                <RefreshCw className="w-5 h-5" /> Resend Verification Email
                            </>
                        )}
                    </button>
                </form>

                {message && (
                    <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 text-green-400">
                        <CheckCircle className="w-5 h-5 shrink-0" />
                        <p className="text-sm">{message}</p>
                    </div>
                )}

                <div className="mt-6 text-sm text-gray-400">
                    Already verified?{' '}
                    <Link to="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
                        Sign in
                    </Link>
                </div>
            </div>
        </div>
    );
}
