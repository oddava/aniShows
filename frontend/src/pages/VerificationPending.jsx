import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import AuthField from '../components/auth/AuthField';
import { UNVERIFIED_ACCOUNT_DAYS, emailProblem } from '../components/auth/formValidation';
import { AlertCircle, Mail, CheckCircle, Loader2, RefreshCw } from 'lucide-react';

export default function VerificationPending() {
    const [searchParams] = useSearchParams();
    const location = useLocation();
    // Register passes the address in router state; older links use ?email=.
    const email = location.state?.email ?? searchParams.get('email') ?? '';
    const stateMessage = typeof location.state?.message === 'string' ? location.state.message : '';
    const [loading, setLoading] = useState(false);
    // { tone: 'success' | 'error', text } after a resend, or null.
    const [result, setResult] = useState(null);
    const [emailError, setEmailError] = useState('');
    const [resendEmail, setResendEmail] = useState(email);

    const handleResend = async (e) => {
        e.preventDefault();
        setResult(null);

        const problem = emailProblem(resendEmail);
        if (problem) {
            setEmailError(problem);
            document.getElementById('resend-email')?.focus();
            return;
        }
        setEmailError('');
        setLoading(true);

        try {
            await authApi.resendVerification(resendEmail.trim());
            setResult({
                tone: 'success',
                text: 'If an account exists with this email and is pending verification, a new link has been sent.',
            });
        } catch {
            setResult({ tone: 'error', text: 'Something went wrong. Please try again.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md bg-dark-100 rounded-2xl p-6 sm:p-8 border border-gray-800 shadow-xl text-center">
                <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Mail className="w-8 h-8 text-accent" aria-hidden="true" />
                </div>

                <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
                <p className="text-gray-400 mb-8">
                    {stateMessage || (
                        <>
                            We've sent a verification link to your email address.
                            Please click the link to activate your account.
                        </>
                    )}
                </p>

                <div className="bg-dark-200 rounded-xl p-4 mb-6">
                    <p className="text-sm text-gray-400 mb-1">Didn't receive the email?</p>
                    <p className="text-xs text-gray-500">Check your spam folder or request a new link below.</p>
                </div>

                <form onSubmit={handleResend} noValidate className="space-y-4 text-left">
                    <AuthField
                        id="resend-email"
                        label="Email address"
                        icon={Mail}
                        type="email"
                        autoComplete="email"
                        required
                        placeholder="Enter your email"
                        value={resendEmail}
                        error={emailError}
                        onChange={(e) => {
                            setResendEmail(e.target.value);
                            setEmailError('');
                        }}
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                <RefreshCw className="w-5 h-5" aria-hidden="true" /> Resend Verification Email
                            </>
                        )}
                    </button>
                </form>

                {result && (
                    <div
                        role={result.tone === 'error' ? 'alert' : 'status'}
                        className={`mt-4 p-4 rounded-xl flex items-center gap-3 text-left ${result.tone === 'error'
                            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                            : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}
                    >
                        {result.tone === 'error'
                            ? <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                            : <CheckCircle className="w-5 h-5 shrink-0" aria-hidden="true" />}
                        <p className="text-sm">{result.text}</p>
                    </div>
                )}

                {/*
                  There is no way to change the address of an account that was
                  never verified (change-email needs a signed-in, re-authenticated
                  session), so the honest fix for a typo is a fresh sign-up.
                */}
                <div className="mt-6 border-t border-gray-800 pt-6 text-left">
                    <h2 className="text-sm font-semibold text-gray-200">Wrong address?</h2>
                    <p className="mt-1 text-sm text-gray-400">
                        Sign up again with the right one. The account with the wrong address is never
                        activated and is removed automatically after {UNVERIFIED_ACCOUNT_DAYS} days. Until
                        then its username stays taken, so pick a different one.
                    </p>
                    <Link to="/register" className="btn-secondary mt-4 w-full flex items-center justify-center">
                        Sign up again
                    </Link>
                </div>

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
