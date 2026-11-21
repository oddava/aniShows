import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User, Lock, Mail, AlertCircle, ArrowRight, Loader2, CheckCircle } from 'lucide-react';
import GoogleLoginButton from '../components/GoogleLoginButton';
import AuthField from '../components/auth/AuthField';
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

const CARD_CLASS = 'bg-dark-100 rounded-2xl p-6 sm:p-8 border border-gray-800 shadow-xl';

function ErrorBanner({ children }) {
    return (
        <div role="alert" className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <p className="text-sm">{children}</p>
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
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0 mt-px" aria-hidden="true" />
            <p className="text-sm">
                {error.message}
                {error.offerReset && (
                    <>
                        {' '}
                        <Link to="/forgot-password" className="font-semibold text-red-300 underline underline-offset-2 hover:text-white">
                            Reset your password
                        </Link>
                    </>
                )}
            </p>
        </div>
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
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
        );
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
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                        <p className="text-gray-400">Sign in to continue your anime journey</p>
                    </div>

                    <div className={CARD_CLASS}>
                    {stateMessage && !error && (
                        <div role="status" className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 text-green-400">
                            <CheckCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <p className="text-sm">{stateMessage}</p>
                        </div>
                    )}
                    <div className="mb-6">
                        <GoogleLoginButton returnTo={returnPath} />
                        <div className="relative mt-6">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-gray-800" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-dark-100 text-gray-400">Or continue with</span>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} noValidate className="space-y-6">
                        <AuthField
                            id={LOGIN_FIELD_IDS.username}
                            label="Username or Email"
                            icon={User}
                            autoComplete="username"
                            required
                            placeholder="Enter your username or email"
                            value={formData.username}
                            error={fieldErrors.username}
                            onChange={updateField('username')}
                        />

                        <div>
                            <AuthField
                                id={LOGIN_FIELD_IDS.password}
                                label="Password"
                                icon={Lock}
                                type="password"
                                autoComplete="current-password"
                                required
                                placeholder="Enter your password"
                                value={formData.password}
                                error={fieldErrors.password}
                                onChange={updateField('password')}
                            />
                            <div className="flex justify-end mt-2">
                                <Link to="/forgot-password" className="text-xs text-accent hover:text-accent-hover transition-colors">
                                    Forgot Password?
                                </Link>
                            </div>
                        </div>

                        {error && <LoginErrorMessage error={error} />}

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
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
        );
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
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
                        <p className="text-gray-400">Join the community and track your anime</p>
                    </div>

                    <div className={CARD_CLASS}>
                    {errors.general && <ErrorBanner>{errors.general}</ErrorBanner>}

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

                    <form onSubmit={handleSubmit} noValidate className="space-y-6">
                        <AuthField
                            id={REGISTER_FIELD_IDS.username}
                            label="Username"
                            icon={User}
                            autoComplete="username"
                            required
                            placeholder="Choose a username"
                            value={formData.username}
                            error={errors.username}
                            onChange={updateField('username')}
                        />

                        <AuthField
                            id={REGISTER_FIELD_IDS.email}
                            label="Email Address"
                            icon={Mail}
                            type="email"
                            autoComplete="email"
                            required
                            placeholder="Enter your email"
                            value={formData.email}
                            error={errors.email}
                            onChange={updateField('email')}
                        />

                        <AuthField
                            id={REGISTER_FIELD_IDS.password}
                            label="Password"
                            icon={Lock}
                            type="password"
                            autoComplete="new-password"
                            required
                            placeholder="Create a password"
                            value={formData.password}
                            error={errors.password}
                            hint={PASSWORD_HINT}
                            onChange={updateField('password')}
                        />

                        <AuthField
                            id={REGISTER_FIELD_IDS.confirmPassword}
                            label="Confirm Password"
                            icon={Lock}
                            type="password"
                            autoComplete="new-password"
                            required
                            placeholder="Confirm your password"
                            value={formData.confirmPassword}
                            error={errors.confirmPassword}
                            onChange={updateField('confirmPassword')}
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
