import { useState } from 'react';
import { getApiErrorMessage } from '../api/errors';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';
import AuthField from '../components/auth/AuthField';
import AuthLayout, { AuthNotice } from '../components/auth/AuthLayout';
import { emailProblem } from '../components/auth/formValidation';

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
            <AuthLayout title="Check your email" lead={message}>
                <p className="text-[15px] leading-relaxed text-[var(--text-2)]">
                    Nothing there after a few minutes? Look in your spam folder.
                </p>
                <Link to="/login" className="btn-secondary mt-8 w-full text-[15px]">
                    Back to sign in
                </Link>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout title="Reset your password" lead="Enter the email on your account and we’ll send a link to set a new one.">
            {status === 'error' && <AuthNotice className="mb-8">{message}</AuthNotice>}

            <form onSubmit={handleSubmit} noValidate className="space-y-6">
                <AuthField
                    id="reset-email"
                    label="Email address"
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

                <button type="submit" disabled={status === 'loading'} className="btn-primary w-full text-[15px]">
                    {status === 'loading' ? 'Sending…' : 'Send reset link'}
                </button>
            </form>

            <p className="mt-8 text-[15px] text-[var(--text-2)]">
                Remembered it? <Link to="/login" className="text-link">Sign in</Link>
            </p>
        </AuthLayout>
    );
}
