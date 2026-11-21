import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GoogleLoginButton from '../components/GoogleLoginButton';
import AuthField from '../components/auth/AuthField';
import AuthLayout, { AuthDivider, AuthNotice } from '../components/auth/AuthLayout';
import { safeReturnPath } from '../components/auth/returnTo';
import SEO from '../components/SEO';
import logger from '../utils/logger';
import { getApiErrorMessage, getApiFieldErrors } from '../api/errors';
import { PASSWORD_HINT } from '../utils/password';
import {
    UNVERIFIED_ACCOUNT_DAYS,
    focusFirstError,
    validateLogin,
    validateRegister,
} from '../components/auth/formValidation';
import { describeLoginError } from '../components/auth/loginErrors';

/** While an already signed-in visitor is sent on. */
function Redirecting() {
    return (
        <div className="page-container pt-12 text-[15px] text-[var(--text-2)] md:pt-24" role="status">
            One moment…
        </div>
    );
}

/**
 * Where to land after signing in: `state.from` (a path string set by the
 * page that sent the user here) or `?next=`, same-origin paths only.
 * `explicit` tells whether either was given, so staff still default to /admin.
 */
function useReturnPath() {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const fromState = location.state?.from;
    const candidate = typeof fromState === 'string' ? fromState : searchParams.get('next');
    const path = safeReturnPath(candidate, '');
    return { path: path || '/browse', explicit: Boolean(path) };
}

const isAdminAccount = (account) => Boolean(account?.is_staff || account?.is_superuser);

/** Drop one field's error once the person edits that field. */
const withoutError = (errors, field) => {
    if (!errors[field]) return errors;
    const next = { ...errors };
    delete next[field];
    return next;
};

const LOGIN_FIELD_IDS = { username: 'login-username', password: 'login-password' };
const REGISTER_FIELD_IDS = {
    username: 'register-username',
    email: 'register-email',
    password: 'register-password',
    confirmPassword: 'register-password-confirm',
};

/** A failed sign-in, inside the form next to the button: one line, maybe a reset link. */
function LoginErrorMessage({ error }) {
    return (
        <AuthNotice>
            {error.message}
            {error.offerReset && (
                <>
                    {' '}
                    <Link to="/forgot-password" className="text-link">
                        Reset your password
                    </Link>
                </>
            )}
        </AuthNotice>
    );
}

export function Login() {
    const [formData, setFormData] = useState({
        username: '',
        password: '',
    });
    const [fieldErrors, setFieldErrors] = useState({});
    // { message, offerReset } from describeLoginError, or null.
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const { login, isAuthenticated, user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { path: returnPath, explicit: hasReturnPath } = useReturnPath();
    const stateMessage = typeof location.state?.message === 'string' ? location.state.message : '';
    const isAdminUser = isAdminAccount(user);

    // Redirect if already authenticated
    useEffect(() => {
        if (isAuthenticated) {
            navigate(isAdminUser && !hasReturnPath ? '/admin' : returnPath, { replace: true });
        }
    }, [isAuthenticated, navigate, isAdminUser, hasReturnPath, returnPath]);

    // Show loading spinner during redirect
    if (isAuthenticated) {
        return <Redirecting />;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        const problems = validateLogin(formData);
        setFieldErrors(problems);
        if (Object.keys(problems).length > 0) {
            focusFirstError(problems, LOGIN_FIELD_IDS);
            return;
        }

        setLoading(true);

        try {
            const loggedInUser = await login(formData.username.trim(), formData.password);
            const toAdmin = isAdminAccount(loggedInUser) && !hasReturnPath;
            navigate(toAdmin ? '/admin' : returnPath, { replace: true });
        } catch (err) {
            logger.error('Login error:', err);
            setError(describeLoginError(err));
        } finally {
            setLoading(false);
        }
    };

    const updateField = (field) => (e) => {
        setFormData({ ...formData, [field]: e.target.value });
        setFieldErrors((current) => withoutError(current, field));
    };

    return (
        <>
            <SEO page="login" />
            <AuthLayout title="Sign in" lead="Welcome back. Pick up where you left off.">
                {stateMessage && !error && (
                    <AuthNotice tone="status" className="mb-8">{stateMessage}</AuthNotice>
                )}

                <GoogleLoginButton returnTo={returnPath} />
                <AuthDivider />

                <form onSubmit={handleSubmit} noValidate className="space-y-6">
                    <AuthField
                        id={LOGIN_FIELD_IDS.username}
                        label="Username or email"
                        autoComplete="username"
                        required
                        value={formData.username}
                        error={fieldErrors.username}
                        onChange={updateField('username')}
                    />

                    <div>
                        <AuthField
                            id={LOGIN_FIELD_IDS.password}
                            label="Password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={formData.password}
                            error={fieldErrors.password}
                            onChange={updateField('password')}
                        />
                        <Link to="/forgot-password" className="text-link mt-3 inline-block text-[15px]">
                            Forgot password?
                        </Link>
                    </div>

                    {error && <LoginErrorMessage error={error} />}

                    <button type="submit" disabled={loading} className="btn-primary w-full text-[15px]">
                        {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>

                <p className="mt-8 text-[15px] text-[var(--text-2)]">
                    New here? <Link to="/register" className="text-link">Create an account</Link>
                </p>
            </AuthLayout>
        </>
    );
}

/** The backend says so in its message when it skips email verification. */
const isVerificationOptional = (response) =>
    typeof response?.message === 'string' && response.message.toLowerCase().includes('optional');

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
        return <Redirecting />;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Every problem at once, under its own field (the form is noValidate).
        const problems = validateRegister(formData);
        setErrors(problems);
        if (Object.keys(problems).length > 0) {
            focusFirstError(problems, REGISTER_FIELD_IDS);
            return;
        }

        setLoading(true);

        let response;
        try {
            response = await register(formData.username, formData.email, formData.password);
        } catch (err) {
            // Field errors live under `errors` in the API's error envelope.
            const fieldErrors = getApiFieldErrors(err);
            const newErrors = { ...fieldErrors };
            if (fieldErrors.non_field_errors) {
                newErrors.general = [].concat(fieldErrors.non_field_errors)[0];
            } else if (Object.keys(fieldErrors).length === 0) {
                newErrors.general = getApiErrorMessage(err, 'Registration failed. Please try again.');
            }
            setErrors(newErrors);
            setLoading(false);
            return;
        }

        if (isVerificationOptional(response)) {
            // There is no email to wait for, so sign straight in.
            try {
                await login(formData.username, formData.password);
                navigate('/browse', { replace: true });
            } catch (err) {
                logger.error('Login after registration failed:', err);
                navigate('/login', { state: { message: 'Account created. Please sign in.' } });
            } finally {
                setLoading(false);
            }
            return;
        }

        setLoading(false);
        navigate('/verification-pending', {
            state: {
                email: formData.email,
                message: `Please check your email to verify your account. Unverified accounts are automatically deleted after ${UNVERIFIED_ACCOUNT_DAYS} days.`,
            }
        });
    };

    const updateField = (field) => (e) => {
        setFormData({ ...formData, [field]: e.target.value });
        setErrors((current) => withoutError(current, field));
    };

    return (
        <>
            <SEO page="register" />
            <AuthLayout title="Create account" lead="Keep track of what you watch, what you thought of it, and what airs next.">
                {errors.general && <AuthNotice className="mb-8">{errors.general}</AuthNotice>}

                <GoogleLoginButton />
                <AuthDivider />

                <form onSubmit={handleSubmit} noValidate className="space-y-6">
                    <AuthField
                        id={REGISTER_FIELD_IDS.username}
                        label="Username"
                        autoComplete="username"
                        required
                        value={formData.username}
                        error={errors.username}
                        onChange={updateField('username')}
                    />

                    <AuthField
                        id={REGISTER_FIELD_IDS.email}
                        label="Email address"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder="name@example.com"
                        value={formData.email}
                        error={errors.email}
                        onChange={updateField('email')}
                    />

                    <AuthField
                        id={REGISTER_FIELD_IDS.password}
                        label="Password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={formData.password}
                        error={errors.password}
                        hint={PASSWORD_HINT}
                        onChange={updateField('password')}
                    />

                    <AuthField
                        id={REGISTER_FIELD_IDS.confirmPassword}
                        label="Confirm password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={formData.confirmPassword}
                        error={errors.confirmPassword}
                        onChange={updateField('confirmPassword')}
                    />

                    <button type="submit" disabled={loading} className="btn-primary w-full text-[15px]">
                        {loading ? 'Creating your account…' : 'Create account'}
                    </button>
                </form>

                <p className="mt-8 text-[15px] text-[var(--text-2)]">
                    Already have an account? <Link to="/login" className="text-link">Sign in</Link>
                </p>
            </AuthLayout>
        </>
    );
}
