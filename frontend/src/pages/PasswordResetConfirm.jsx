import { useState } from 'react';
import { getApiErrorMessage } from '../api/errors';
import { PASSWORD_HINT } from '../utils/password';
import { useNavigate } from 'react-router-dom';
import useTokenLinkParams from '../components/auth/useTokenLinkParams';
import AuthField from '../components/auth/AuthField';
import {
    confirmPasswordProblem,
    focusFirstError,
    newPasswordProblem,
} from '../components/auth/formValidation';
import { authApi } from '../api/client';
import { Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

const FIELD_IDS = { password: 'reset-new-password', confirmPassword: 'reset-new-password-confirm' };

export default function PasswordResetConfirm() {
    // The token moves out of the address bar before anything else runs (A14).
    const { linkParams, isRedirecting } = useTokenLinkParams(['uid', 'token'], '/reset-password');
    const uid = linkParams?.uid;
    const token = linkParams?.token;
    const isMissingLink = !isRedirecting && (!uid || !token);
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (isMissingLink) {
            setError('This reset link is incomplete. Request a new one.');
            return;
        }

        // Both fields checked at once, each message under its field.
        const problems = {};
        const passwordError = newPasswordProblem(password, 'Enter a new password.');
        if (passwordError) problems.password = passwordError;
        const confirmError = confirmPasswordProblem(password, confirmPassword);
        if (confirmError) problems.confirmPassword = confirmError;
        setFieldErrors(problems);
        if (Object.keys(problems).length > 0) {
            focusFirstError(problems, FIELD_IDS);
            return;
        }

        setStatus('loading');

        try {
            await authApi.resetPassword(uid, token, password);
            navigate('/login', {
                replace: true,
                state: { message: 'Password reset successfully. Please login with your new password.' }
            });
        } catch (err) {
            setStatus('idle');
            setError(getApiErrorMessage(err, 'Failed to reset password'));
        }
    };

    const clearFieldError = (field) => setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
    });

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">Set New Password</h1>
                    <p className="text-gray-400">Create a new password for your account</p>
                </div>

                <div className="bg-dark-100 rounded-2xl p-6 sm:p-8 border border-gray-800 shadow-xl">
                    {error && (
                        <div role="alert" className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} noValidate className="space-y-6">
                        <AuthField
                            id={FIELD_IDS.password}
                            label="New Password"
                            icon={Lock}
                            type="password"
                            autoComplete="new-password"
                            required
                            placeholder="Enter new password"
                            value={password}
                            error={fieldErrors.password}
                            hint={PASSWORD_HINT}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                clearFieldError('password');
                            }}
                        />

                        <AuthField
                            id={FIELD_IDS.confirmPassword}
                            label="Confirm Password"
                            icon={Lock}
                            type="password"
                            autoComplete="new-password"
                            required
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            error={fieldErrors.confirmPassword}
                            onChange={(e) => {
                                setConfirmPassword(e.target.value);
                                clearFieldError('confirmPassword');
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
                                    Reset Password <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
