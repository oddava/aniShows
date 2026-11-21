import { useState } from 'react';
import { getApiErrorMessage } from '../api/errors';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';
import AuthField from '../components/auth/AuthField';
import { emailProblem } from '../components/auth/formValidation';
import { Mail, ArrowRight, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function PasswordReset() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [message, setMessage] = useState('');
    const [emailError, setEmailError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        const problem = emailProblem(email);
        if (problem) {
            setStatus('idle');
            setEmailError(problem);
            document.getElementById('reset-email')?.focus();
            return;
        }
        setEmailError('');
        setStatus('loading');

        try {
            await authApi.requestPasswordReset(email.trim());
            setStatus('success');
            setMessage('If an account exists with this email, a reset link has been sent.');
        } catch (err) {
            setStatus('error');
            setMessage(getApiErrorMessage(err, 'Failed to send reset link'));
        }
    };

    if (status === 'success') {
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md bg-dark-100 rounded-2xl p-6 sm:p-8 border border-gray-800 shadow-xl text-center">
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

                <div className="bg-dark-100 rounded-2xl p-6 sm:p-8 border border-gray-800 shadow-xl">
                    {status === 'error' && (
                        <div role="alert" className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <p className="text-sm">{message}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} noValidate className="space-y-6">
                        <AuthField
                            id="reset-email"
                            label="Email Address"
                            icon={Mail}
                            type="email"
                            autoComplete="email"
                            required
                            placeholder="Enter your email"
                            value={email}
                            error={emailError}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                setEmailError('');
                            }}
                        />

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
