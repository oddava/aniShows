import { getPasswordProblem } from '../../utils/password';

/**
 * Client-side checks for the auth forms. The forms set `noValidate`, so these
 * messages (shown under each field, all at once) replace the browser's own
 * one-field-at-a-time tooltip. The server stays authoritative.
 */

/**
 * Days an unverified account is kept before the daily cleanup removes it
 * (`unverified_days` of user-maintenance-daily in root/settings/celery_schedule.py).
 */
export const UNVERIFIED_ACCOUNT_DAYS = 7;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value) => EMAIL_PATTERN.test(String(value ?? '').trim());

const isBlank = (value) => !String(value ?? '').trim();

/** Error for an email field, or null. */
export const emailProblem = (value) => {
    if (isBlank(value)) return 'Enter your email address.';
    if (!isValidEmail(value)) return 'Enter a valid email address, like name@example.com.';
    return null;
};

/** Error for a new password, or null (empty, then the shared password rules). */
export const newPasswordProblem = (value, emptyMessage = 'Create a password.') =>
    (value ? getPasswordProblem(value) : emptyMessage);

/** Error for a "type it again" field, or null. */
export const confirmPasswordProblem = (password, confirmation) => {
    if (!confirmation) return 'Type the password again.';
    if (password !== confirmation) return 'Passwords do not match.';
    return null;
};

export function validateLogin({ username, password }) {
    const errors = {};
    if (isBlank(username)) errors.username = 'Enter your username or email.';
    if (!password) errors.password = 'Enter your password.';
    return errors;
}

export function validateRegister({ username, email, password, confirmPassword }) {
    const errors = {};
    if (isBlank(username)) errors.username = 'Choose a username.';
    const emailError = emailProblem(email);
    if (emailError) errors.email = emailError;
    const passwordError = newPasswordProblem(password);
    if (passwordError) errors.password = passwordError;
    const confirmError = confirmPasswordProblem(password, confirmPassword);
    if (confirmError) errors.confirmPassword = confirmError;
    return errors;
}

/**
 * Move focus to the first field (in `idsByField` order) with an error, so keyboard
 * and screen-reader users land on it after a failed submit.
 */
export function focusFirstError(errors, idsByField) {
    const first = Object.keys(idsByField).find((field) => errors[field]);
    if (first) document.getElementById(idsByField[first])?.focus();
}
