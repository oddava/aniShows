import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import AuthField from '../components/auth/AuthField';
import AuthLayout, { AuthNotice } from '../components/auth/AuthLayout';
import { UNVERIFIED_ACCOUNT_DAYS, emailProblem } from '../components/auth/formValidation';

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
        <AuthLayout
            title="Check your email"
            lead={stateMessage || 'We’ve sent a verification link to your email address. Open it to activate your account.'}
        >
            <h2 className="section-title">Didn’t get it?</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-2)]">
                Look in your spam folder, or send a new link.
            </p>

            <form onSubmit={handleResend} noValidate className="mt-6 space-y-6">
                <AuthField
                    id="resend-email"
                    label="Email address"
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

                <button type="submit" disabled={loading} className="btn-primary w-full text-[15px]">
                    {loading ? 'Sending…' : 'Resend verification email'}
                </button>
            </form>

            {result && (
                <AuthNotice tone={result.tone === 'error' ? 'error' : 'status'} className="mt-6">
                    {result.text}
                </AuthNotice>
            )}

            {/*
              There is no way to change the address of an account that was
              never verified (change-email needs a signed-in, re-authenticated
              session), so the honest fix for a typo is a fresh sign-up.
            */}
            <div className="mt-10 pt-8">
                <h2 className="section-title">Wrong address?</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-2)]">
                    Sign up again with the right one. The account with the wrong address is never
                    activated and is removed automatically after {UNVERIFIED_ACCOUNT_DAYS} days. Until
                    then its username stays taken, so pick a different one.
                </p>
                <Link to="/register" className="btn-secondary mt-5 w-full text-[15px]">
                    Sign up again
                </Link>
            </div>

            <p className="mt-8 text-[15px] text-[var(--text-2)]">
                Already verified? <Link to="/login" className="text-link">Sign in</Link>
            </p>
        </AuthLayout>
    );
}
